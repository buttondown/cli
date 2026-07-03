import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collect, jsonResponse, mockFetch, parseUrl } from "../test-helpers.js";
import { serialize as serializeEmail } from "./emails.js";
import { type ProgressEvent, pull, push } from "./orchestrate.js";
import { writeSyncState } from "./state.js";

describe("orchestrate", () => {
	let tempDir: string;
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "orchestrate-test-"));
		originalFetch = globalThis.fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	const config = () => ({
		baseUrl: "https://api.buttondown.com",
		apiKey: "test-key",
		directory: tempDir,
	});

	describe("pull", () => {
		test("yields start, then per-resource, then finish in that order", async () => {
			mockFetch(async (_, url) => {
				if (url.pathname === "/images")
					return jsonResponse({
						results: [
							{
								id: "img_1",
								image: "https://assets.buttondown.email/images/photo.png",
								creation_date: "2025-01-01",
							},
						],
						count: 1,
					});
				if (url.hostname === "assets.buttondown.email")
					return new Response(Buffer.from("png"), { status: 200 });
				if (url.pathname === "/emails")
					return jsonResponse({
						results: [
							{ id: "email_1", subject: "Hi", slug: "hi", body: "hello" },
						],
						count: 1,
					});
			});

			const events = await collect(pull(config()));

			expect(events[0].type).toBe("start");
			expect(events[events.length - 1].type).toBe("finish");

			const resourceOrder = events
				.filter((e) => e.type === "resource")
				.map(
					(e) => (e as Extract<ProgressEvent, { type: "resource" }>).resource,
				);
			// base resources first, then images, then emails
			expect(resourceOrder.indexOf("images")).toBeGreaterThan(
				resourceOrder.indexOf("automations"),
			);
			expect(resourceOrder.indexOf("emails")).toBeGreaterThan(
				resourceOrder.indexOf("images"),
			);
		});

		test("does not redownload images already tracked in sync state", async () => {
			// Seed sync state with an image whose remote URL has a UUID filename
			// but local copy uses the original photo.png name.
			const mediaDir = path.join(tempDir, "media");
			await mkdir(mediaDir, { recursive: true });
			await writeFile(path.join(mediaDir, "photo.png"), "original");
			await writeSyncState(tempDir, {
				syncedImages: {
					img_1: {
						id: "img_1",
						localPath: path.join(mediaDir, "photo.png"),
						url: "https://assets.buttondown.email/images/abc123.png",
						filename: "photo.png",
					},
				},
			});

			let downloads = 0;
			mockFetch(async (_, url) => {
				if (url.pathname === "/images")
					return jsonResponse({
						results: [
							{
								id: "img_1",
								image: "https://assets.buttondown.email/images/abc123.png",
								creation_date: "2025-01-01",
							},
						],
						count: 1,
					});
				if (url.hostname === "assets.buttondown.email") {
					downloads++;
					return new Response(Buffer.from("new"), { status: 200 });
				}
			});

			await collect(pull(config()));

			expect(downloads).toBe(0);
			const data = await readFile(path.join(mediaDir, "photo.png"), "utf8");
			expect(data).toBe("original");
		});

		test("propagates network errors as thrown exceptions", async () => {
			globalThis.fetch = mock(async () => {
				throw new Error("boom");
			}) as unknown as typeof fetch;

			await expect(collect(pull(config()))).rejects.toThrow("boom");
		});
	});

	describe("push", () => {
		async function seedDirectory() {
			const emailsDir = path.join(tempDir, "emails");
			await mkdir(emailsDir, { recursive: true });
			await writeSyncState(tempDir, { syncedImages: {} });
			await writeFile(
				path.join(tempDir, "newsletter.json"),
				JSON.stringify({ id: "nl_1", name: "Test" }),
			);
			return emailsDir;
		}

		test("dry run yields dry_run_complete and never POSTs/PATCHes", async () => {
			const emailsDir = await seedDirectory();
			await writeFile(
				path.join(emailsDir, "draft.md"),
				serializeEmail({
					subject: "New",
					slug: "new-post",
					body: "no image refs",
				}),
			);

			const recorded = mockFetch();

			const events = await collect(push({ ...config(), dryRun: true }));

			const last = events[events.length - 1];
			expect(last.type).toBe("dry_run_complete");
			expect(events.find((e) => e.type === "resource")).toBeUndefined();

			const writes = recorded.filter(
				(r) => r.method === "POST" || r.method === "PATCH",
			);
			expect(writes).toHaveLength(0);
		});

		test("dry run does not write sync state", async () => {
			await seedDirectory();
			const before = await readFile(
				path.join(tempDir, ".buttondown.json"),
				"utf8",
			);

			mockFetch();
			await collect(push({ ...config(), dryRun: true }));

			const after = await readFile(
				path.join(tempDir, ".buttondown.json"),
				"utf8",
			);
			expect(after).toBe(before);
		});

		test("real run only PATCHes emails whose serialized form differs from remote", async () => {
			const emailsDir = await seedDirectory();
			const unchanged = {
				id: "email_unchanged",
				subject: "Same",
				slug: "same",
				body: "no changes",
			};
			const changed = {
				id: "email_changed",
				subject: "Old subject",
				slug: "changed",
				body: "old body",
			};
			await writeFile(
				path.join(emailsDir, "same.md"),
				serializeEmail(unchanged),
			);
			// local has new subject; remote still has the old
			await writeFile(
				path.join(emailsDir, "changed.md"),
				serializeEmail({ ...changed, subject: "New subject" }),
			);

			const recorded = mockFetch(async (_, url) => {
				if (url.pathname === "/emails")
					return jsonResponse({
						results: [unchanged, changed],
						count: 2,
					});
			});

			await collect(push(config()));

			const emailPatches = recorded.filter(
				(r) => r.method === "PATCH" && r.pathname.startsWith("/emails/"),
			);
			expect(emailPatches).toHaveLength(1);
			expect(emailPatches[0].pathname).toBe("/emails/email_changed");
		});

		test("uploads new images before PATCHing the emails that reference them", async () => {
			const emailsDir = await seedDirectory();
			const mediaDir = path.join(tempDir, "media");
			await mkdir(mediaDir, { recursive: true });
			await writeFile(path.join(mediaDir, "hero.png"), "png-bytes");

			await writeFile(
				path.join(emailsDir, "post.md"),
				serializeEmail({
					id: "email_1",
					subject: "Has image",
					slug: "post",
					body: "look: ![hero](../media/hero.png)",
				}),
			);

			const recorded = mockFetch(
				async (request, url) => {
					if (url.pathname === "/images" && request.method === "POST") {
						return jsonResponse(
							{
								id: "img_uploaded",
								image: "https://assets.buttondown.email/images/hero.png",
								creation_date: "2025-01-01",
							},
							201,
						);
					}
				},
				async (request, url) => {
					if (url.pathname.startsWith("/emails/") && request.method === "PATCH")
						return jsonResponse({});
				},
			);

			await collect(push(config()));

			const writes = recorded.filter(
				(r) =>
					(r.method === "POST" && r.pathname === "/images") ||
					(r.method === "PATCH" && r.pathname.startsWith("/emails/")),
			);
			expect(writes.length).toBeGreaterThanOrEqual(2);
			// image upload must come before email PATCH
			const imageIdx = writes.findIndex(
				(r) => r.method === "POST" && r.pathname === "/images",
			);
			const patchIdx = writes.findIndex(
				(r) => r.method === "PATCH" && r.pathname.startsWith("/emails/"),
			);
			expect(imageIdx).toBeLessThan(patchIdx);

			// PATCH body should contain the absolute URL, not the relative path
			const patchBody = writes[patchIdx].body as { body?: string };
			expect(patchBody.body).toContain(
				"https://assets.buttondown.email/images/hero.png",
			);
			expect(patchBody.body).not.toContain("../media/hero.png");
		});

		test("real run writes updated sync state including newly uploaded images", async () => {
			const emailsDir = await seedDirectory();
			const mediaDir = path.join(tempDir, "media");
			await mkdir(mediaDir, { recursive: true });
			await writeFile(path.join(mediaDir, "fresh.png"), "png");
			await writeFile(
				path.join(emailsDir, "post.md"),
				serializeEmail({
					id: "email_1",
					subject: "Hi",
					slug: "post",
					body: "![x](../media/fresh.png)",
				}),
			);

			mockFetch(
				async (request, url) => {
					if (url.pathname === "/images" && request.method === "POST")
						return jsonResponse(
							{
								id: "img_fresh",
								image: "https://assets.buttondown.email/images/fresh.png",
								creation_date: "2025-01-01",
							},
							201,
						);
				},
				async (request, url) => {
					if (url.pathname.startsWith("/emails/") && request.method === "PATCH")
						return jsonResponse({});
				},
			);

			await collect(push(config()));

			const state = JSON.parse(
				await readFile(path.join(tempDir, ".buttondown.json"), "utf8"),
			);
			expect(state.syncedImages.img_fresh).toBeDefined();
			expect(state.syncedImages.img_fresh.url).toBe(
				"https://assets.buttondown.email/images/fresh.png",
			);
		});

		test("propagates network failures as thrown exceptions", async () => {
			await seedDirectory();
			globalThis.fetch = mock(async (input: Request | string) => {
				const url = parseUrl(input);
				if (url.pathname === "/emails") throw new Error("network down");
				return jsonResponse({ results: [], count: 0 });
			}) as unknown as typeof fetch;

			await expect(collect(push(config()))).rejects.toThrow("network down");
		});

		test("reports a 422 PATCH failure with the API's validation detail without aborting", async () => {
			const emailsDir = await seedDirectory();
			await writeFile(
				path.join(emailsDir, "bad.md"),
				serializeEmail({
					id: "email_bad",
					subject: "New subject",
					slug: "bad",
					body: "new body",
				}),
			);
			await writeFile(
				path.join(emailsDir, "good.md"),
				serializeEmail({
					id: "email_good",
					subject: "Also new",
					slug: "good",
					body: "also new",
				}),
			);

			const patched: string[] = [];
			mockFetch(
				async (_, url) => {
					if (url.pathname === "/emails")
						return jsonResponse({
							results: [
								{ id: "email_bad", subject: "Old", slug: "bad", body: "old" },
								{ id: "email_good", subject: "Old", slug: "good", body: "old" },
							],
							count: 2,
						});
				},
				async (request, url) => {
					if (
						url.pathname.startsWith("/emails/") &&
						request.method === "PATCH"
					) {
						patched.push(url.pathname);
						if (url.pathname.endsWith("email_bad"))
							return jsonResponse({ detail: "id is not a valid field" }, 422);
						return jsonResponse({});
					}
				},
			);

			const events = await collect(push(config()));

			// Both PATCHes were attempted: one failure doesn't wedge the rest.
			expect(patched).toHaveLength(2);
			const emailsEvent = events.find(
				(e): e is Extract<ProgressEvent, { type: "resource" }> =>
					e.type === "resource" && e.resource === "emails",
			);
			expect(emailsEvent?.result.failed).toBe(1);
			expect(emailsEvent?.result.updated).toBe(1);
			expect(emailsEvent?.result.errors[0]).toContain(
				"id is not a valid field",
			);
		});

		test("writes the server-assigned id back into the file after creating", async () => {
			const emailsDir = await seedDirectory();
			const filePath = path.join(emailsDir, "brand-new.md");
			await writeFile(
				filePath,
				serializeEmail({
					subject: "Brand New",
					slug: "brand-new",
					body: "fresh content",
				}),
			);

			mockFetch(async (request, url) => {
				if (url.pathname === "/emails" && request.method === "POST")
					return jsonResponse(
						{ id: "email_created", subject: "Brand New", slug: "brand-new" },
						201,
					);
			});

			await collect(push(config()));

			const content = await readFile(filePath, "utf8");
			expect(content).toContain("email_created");
		});

		test("skips emails with unresolvable image references instead of pushing relative paths", async () => {
			const emailsDir = await seedDirectory();
			await writeFile(
				path.join(emailsDir, "broken.md"),
				serializeEmail({
					id: "email_broken",
					subject: "Broken",
					slug: "broken",
					body: "look: ![missing](../media/does-not-exist.png)",
				}),
			);

			const recorded = mockFetch(async (_, url) => {
				if (url.pathname === "/emails")
					return jsonResponse({
						results: [
							{
								id: "email_broken",
								subject: "Old",
								slug: "broken",
								body: "old",
							},
						],
						count: 1,
					});
			});

			const events = await collect(push(config()));

			const patches = recorded.filter(
				(r) => r.method === "PATCH" && r.pathname.startsWith("/emails/"),
			);
			expect(patches).toHaveLength(0);
			const warnings = events.filter((e) => e.type === "warning");
			expect(warnings.length).toBeGreaterThan(0);
		});

		test("propagates HTTP errors on list endpoints instead of treating them as empty", async () => {
			await seedDirectory();
			mockFetch(async (_, url) => {
				if (url.pathname === "/emails")
					return jsonResponse({ detail: "Invalid API token" }, 401);
			});

			await expect(collect(push(config()))).rejects.toThrow(
				"Invalid API token",
			);
		});

		test("round-trips pull then push with a cwd-relative directory without pushing anything", async () => {
			const previousCwd = process.cwd();
			process.chdir(tempDir);
			try {
				const configuration = {
					baseUrl: "https://api.buttondown.com",
					apiKey: "test-key",
					directory: "./buttondown",
				};
				const remoteEmail = {
					id: "email_rel",
					subject: "Relative",
					slug: "relative",
					body: "pic: ![p](https://assets.buttondown.email/images/abc123.png)",
				};
				const recorded = mockFetch(async (_, url) => {
					if (url.pathname === "/images")
						return jsonResponse({
							results: [
								{
									id: "img_rel",
									image: "https://assets.buttondown.email/images/abc123.png",
									creation_date: "2025-01-01",
								},
							],
							count: 1,
						});
					if (url.hostname === "assets.buttondown.email")
						return new Response(Buffer.from("png"), { status: 200 });
					if (url.pathname === "/emails")
						return jsonResponse({ results: [remoteEmail], count: 1 });
				});

				await collect(pull(configuration));
				await collect(push(configuration));

				const writes = recorded.filter(
					(r) =>
						(r.method === "PATCH" || r.method === "POST") &&
						(r.pathname.startsWith("/emails") ||
							r.pathname.startsWith("/images")),
				);
				expect(writes).toHaveLength(0);
			} finally {
				process.chdir(previousCwd);
			}
		});
	});
});
