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

describe("push", () => {
	let tempDir: string;
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "push-test-"));
		originalFetch = globalThis.fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("should upload new images and replace relative paths with absolute URLs", async () => {
		// Set up local files
		const emailsDir = path.join(tempDir, "emails");
		const mediaDir = path.join(tempDir, "media");
		await mkdir(emailsDir, { recursive: true });
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

		// Empty initial sync state
		await writeSyncState(tempDir, { syncedImages: {} });

		// Create newsletter.json to avoid errors from newsletter local.get
		await writeFile(
			path.join(tempDir, "newsletter.json"),
			JSON.stringify({ id: "nl_1", name: "Test" }),
		);

		const pushedEmails: any[] = [];

		globalThis.fetch = mock(async (request: Request) => {
			const url = new URL(request.url);

			// Image upload
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

			// Email push (PATCH existing)
			if (url.pathname.includes("/emails/") && request.method === "PATCH") {
				const body = await request.json();
				pushedEmails.push(body);
				return jsonResponse({});
			}

			// Base resource API calls (newsletter patch, automations, snippets)
			if (
				url.pathname.includes("/newsletters/") &&
				request.method === "PATCH"
			) {
				return jsonResponse({});
			}

			return jsonResponse({ results: [], count: 0 });
		}) as unknown as typeof fetch;

		render(
			<Push
				baseUrl="https://api.buttondown.com"
				apiKey="test-key"
				directory={tempDir}
			/>,
		);

		await delay(500);

		// Email should have been pushed with absolute URL
		expect(pushedEmails).toHaveLength(1);
		expect(pushedEmails[0].body).toContain(
			"https://assets.buttondown.email/images/photo.png",
		);
		expect(pushedEmails[0].body).not.toContain("../media/photo.png");

		// Sync state should be updated with the new image
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
		const emailsDir = path.join(tempDir, "emails");
		const mediaDir = path.join(tempDir, "media");
		await mkdir(emailsDir, { recursive: true });
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

		// Pre-populate sync state with the image already synced
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

		await writeFile(
			path.join(tempDir, "newsletter.json"),
			JSON.stringify({ id: "nl_1", name: "Test" }),
		);

		let imageUploadCount = 0;
		const pushedEmails: any[] = [];

		globalThis.fetch = mock(async (request: Request) => {
			const url = new URL(request.url);

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

			if (url.pathname.includes("/emails/") && request.method === "PATCH") {
				const body = await request.json();
				pushedEmails.push(body);
				return jsonResponse({});
			}

			if (
				url.pathname.includes("/newsletters/") &&
				request.method === "PATCH"
			) {
				return jsonResponse({});
			}

			return jsonResponse({ results: [], count: 0 });
		}) as unknown as typeof fetch;

		render(
			<Push
				baseUrl="https://api.buttondown.com"
				apiKey="test-key"
				directory={tempDir}
			/>,
		);

		await delay(500);

		// Should NOT have uploaded the image again
		expect(imageUploadCount).toBe(0);

		// Email should still have the absolute URL resolved from sync state
		expect(pushedEmails).toHaveLength(1);
		expect(pushedEmails[0].body).toContain(
			"https://assets.buttondown.email/images/photo.png",
		);
	});

	test("should push emails without images unchanged", async () => {
		const emailsDir = path.join(tempDir, "emails");
		await mkdir(emailsDir, { recursive: true });

		await writeFile(
			path.join(emailsDir, "plain-post.md"),
			serialize({
				id: "email_3",
				subject: "Plain Post",
				slug: "plain-post",
				body: "Just text, no images here.",
			}),
		);

		await writeSyncState(tempDir, { syncedImages: {} });
		await writeFile(
			path.join(tempDir, "newsletter.json"),
			JSON.stringify({ id: "nl_1", name: "Test" }),
		);

		const pushedEmails: any[] = [];

		globalThis.fetch = mock(async (request: Request) => {
			const url = new URL(request.url);

			if (url.pathname.includes("/emails/") && request.method === "PATCH") {
				const body = await request.json();
				pushedEmails.push(body);
				return jsonResponse({});
			}

			if (
				url.pathname.includes("/newsletters/") &&
				request.method === "PATCH"
			) {
				return jsonResponse({});
			}

			return jsonResponse({ results: [], count: 0 });
		}) as unknown as typeof fetch;

		render(
			<Push
				baseUrl="https://api.buttondown.com"
				apiKey="test-key"
				directory={tempDir}
			/>,
		);

		await delay(500);

		expect(pushedEmails).toHaveLength(1);
		expect(pushedEmails[0].body).toBe("Just text, no images here.");
	});
});
