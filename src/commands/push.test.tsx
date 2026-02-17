import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import delay from "delay";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { render } from "ink-testing-library";
import { serialize } from "../sync/emails.js";
import { writeSyncState } from "../sync/state.js";
import Push from "./push.js";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

type RouteHandler = (
	request: Request,
	url: URL,
) => Response | Promise<Response | undefined> | undefined;

function mockFetch(...handlers: RouteHandler[]) {
	globalThis.fetch = mock(async (request: Request) => {
		const url = new URL(request.url);
		for (const handler of handlers) {
			const response = await handler(request, url);
			if (response) return response;
		}
		// Default: newsletter PATCH succeeds, everything else returns empty list
		if (url.pathname.includes("/newsletters/") && request.method === "PATCH") {
			return jsonResponse({});
		}
		return jsonResponse({ results: [], count: 0 });
	}) as unknown as typeof fetch;
}

describe("push", () => {
	let tempDir: string;
	let emailsDir: string;
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "push-test-"));
		emailsDir = path.join(tempDir, "emails");
		originalFetch = globalThis.fetch;
		await mkdir(emailsDir, { recursive: true });
		await writeSyncState(tempDir, { syncedImages: {} });
		await writeFile(
			path.join(tempDir, "newsletter.json"),
			JSON.stringify({ id: "nl_1", name: "Test" }),
		);
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	function renderPush() {
		render(
			<Push
				baseUrl="https://api.buttondown.com"
				apiKey="test-key"
				directory={tempDir}
			/>,
		);
		return delay(500);
	}

	test("should upload new images and replace relative paths with absolute URLs", async () => {
		const mediaDir = path.join(tempDir, "media");
		await mkdir(mediaDir, { recursive: true });

		await writeFile(
			path.join(emailsDir, "test-post.md"),
			serialize({
				id: "email_1",
				subject: "Test Post",
				slug: "test-post",
				body: "Here is ![photo](../media/photo.png) in my post",
			}),
		);
		await writeFile(
			path.join(mediaDir, "photo.png"),
			Buffer.from("real-png-data"),
		);

		const pushedEmails: any[] = [];

		mockFetch(
			async (request, url) => {
				if (url.pathname === "/images" && request.method === "POST") {
					const formData = await request.formData();
					const file = formData.get("image") as File;
					expect(file).toBeTruthy();
					expect(file.name).toBe("photo.png");
					return jsonResponse(
						{
							id: "img_uploaded",
							image: "https://assets.buttondown.email/images/photo.png",
							creation_date: "2025-01-01",
						},
						201,
					);
				}
			},
			async (request, url) => {
				if (url.pathname.includes("/emails/") && request.method === "PATCH") {
					const body = await request.json();
					pushedEmails.push(body);
					return jsonResponse({});
				}
			},
		);

		await renderPush();

		expect(pushedEmails).toHaveLength(1);
		expect(pushedEmails[0].body).toContain(
			"https://assets.buttondown.email/images/photo.png",
		);
		expect(pushedEmails[0].body).not.toContain("../media/photo.png");
		expect(pushedEmails[0].body).toContain(
			"<!-- buttondown-editor-mode: plaintext -->",
		);

		const state = JSON.parse(
			await readFile(path.join(tempDir, ".buttondown.json"), "utf8"),
		);
		expect(state.syncedImages.img_uploaded).toEqual({
			id: "img_uploaded",
			localPath: path.join(tempDir, "media", "photo.png"),
			url: "https://assets.buttondown.email/images/photo.png",
			filename: "photo.png",
		});
	});

	test("should skip upload for already-synced images", async () => {
		const mediaDir = path.join(tempDir, "media");
		await mkdir(mediaDir, { recursive: true });

		await writeFile(
			path.join(emailsDir, "reuse-post.md"),
			serialize({
				id: "email_2",
				subject: "Reuse Post",
				slug: "reuse-post",
				body: "Reusing ![photo](../media/photo.png) again",
			}),
		);
		await writeFile(path.join(mediaDir, "photo.png"), Buffer.from("png-data"));

		await writeSyncState(tempDir, {
			syncedImages: {
				img_existing: {
					id: "img_existing",
					localPath: path.join(tempDir, "media", "photo.png"),
					url: "https://assets.buttondown.email/images/photo.png",
					filename: "photo.png",
				},
			},
		});

		let imageUploadCount = 0;
		const pushedEmails: any[] = [];

		mockFetch(
			(request, url) => {
				if (url.pathname === "/images" && request.method === "POST") {
					imageUploadCount++;
					return jsonResponse(
						{
							id: "img_new",
							image: "https://example.com/new.png",
							creation_date: "2025-01-01",
						},
						201,
					);
				}
			},
			async (request, url) => {
				if (url.pathname.includes("/emails/") && request.method === "PATCH") {
					const body = await request.json();
					pushedEmails.push(body);
					return jsonResponse({});
				}
			},
		);

		await renderPush();

		expect(imageUploadCount).toBe(0);
		expect(pushedEmails).toHaveLength(1);
		expect(pushedEmails[0].body).toContain(
			"https://assets.buttondown.email/images/photo.png",
		);
	});

	test("should not push unchanged emails", async () => {
		await writeFile(
			path.join(emailsDir, "unchanged.md"),
			serialize({
				id: "email_unchanged",
				subject: "Unchanged Post",
				slug: "unchanged",
				body: "Same content as remote",
			}),
		);
		await writeFile(
			path.join(emailsDir, "changed.md"),
			serialize({
				id: "email_changed",
				subject: "Changed Post",
				slug: "changed",
				body: "Updated locally",
			}),
		);

		const pushedEmailIds: string[] = [];

		mockFetch(
			(request, url) => {
				if (url.pathname === "/emails" && request.method === "GET") {
					return jsonResponse({
						results: [
							{
								id: "email_unchanged",
								subject: "Unchanged Post",
								slug: "unchanged",
								body: "<!-- buttondown-editor-mode: plaintext -->Same content as remote",
							},
							{
								id: "email_changed",
								subject: "Changed Post",
								slug: "changed",
								body: "<!-- buttondown-editor-mode: plaintext -->Old content from remote",
							},
						],
						count: 2,
					});
				}
			},
			(request, url) => {
				if (url.pathname.includes("/emails/") && request.method === "PATCH") {
					const id = url.pathname.split("/emails/")[1];
					pushedEmailIds.push(id);
					return jsonResponse({});
				}
			},
		);

		await renderPush();

		expect(pushedEmailIds).toHaveLength(1);
		expect(pushedEmailIds[0]).toBe("email_changed");
	});

	test("should push emails without images with plaintext sigil", async () => {
		await writeFile(
			path.join(emailsDir, "plain-post.md"),
			serialize({
				id: "email_3",
				subject: "Plain Post",
				slug: "plain-post",
				body: "Just text, no images here.",
			}),
		);

		const pushedEmails: any[] = [];

		mockFetch(async (request, url) => {
			if (url.pathname.includes("/emails/") && request.method === "PATCH") {
				const body = await request.json();
				pushedEmails.push(body);
				return jsonResponse({});
			}
		});

		await renderPush();

		expect(pushedEmails).toHaveLength(1);
		expect(pushedEmails[0].body).toBe(
			"<!-- buttondown-editor-mode: plaintext -->Just text, no images here.",
		);
	});
});
