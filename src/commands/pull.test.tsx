import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import delay from "delay";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { render } from "ink-testing-library";
import Pull from "./pull.js";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function parseUrl(input: Request | string): URL {
	if (typeof input === "string") return new URL(input);
	return new URL(input.url);
}

describe("pull", () => {
	let tempDir: string;
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "pull-test-"));
		originalFetch = globalThis.fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("should convert absolute image URLs to relative paths in pulled emails", async () => {
		globalThis.fetch = mock(async (input: Request | string) => {
			const url = parseUrl(input);

			// Base resources return empty
			if (url.pathname.includes("/automations"))
				return jsonResponse({ results: [], count: 0 });
			if (url.pathname.includes("/newsletters"))
				return jsonResponse({ results: [], count: 0 });
			if (url.pathname.includes("/snippets"))
				return jsonResponse({ results: [], count: 0 });

			// Images API
			if (url.pathname === "/images") {
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
			}

			// Image file download
			if (url.hostname === "assets.buttondown.email") {
				return new Response(Buffer.from("fake-png-data"), { status: 200 });
			}

			// Emails API
			if (url.pathname === "/emails") {
				return jsonResponse({
					results: [
						{
							id: "email_1",
							subject: "Test Email",
							slug: "test-email",
							body: "Check this: ![photo](https://assets.buttondown.email/images/photo.png)",
						},
					],
					count: 1,
				});
			}

			return jsonResponse({});
		}) as unknown as typeof fetch;

		render(
			<Pull
				baseUrl="https://api.buttondown.com"
				apiKey="test-key"
				directory={tempDir}
			/>,
		);

		await delay(1000);

		// Email should have relative path, not absolute URL
		const emailContent = await readFile(
			path.join(tempDir, "emails", "test-email.md"),
			"utf8",
		);
		expect(emailContent).toContain("../media/photo.png");
		expect(emailContent).not.toContain(
			"https://assets.buttondown.email/images/photo.png",
		);

		// Image should be downloaded
		const imageData = await readFile(path.join(tempDir, "media", "photo.png"));
		expect(imageData.toString()).toBe("fake-png-data");

		// Sync state should be written
		const stateContent = await readFile(
			path.join(tempDir, ".buttondown.json"),
			"utf8",
		);
		const state = JSON.parse(stateContent);
		expect(state.syncedImages.img_1).toEqual({
			id: "img_1",
			localPath: path.join(tempDir, "media", "photo.png"),
			url: "https://assets.buttondown.email/images/photo.png",
			filename: "photo.png",
		});
	});

	test("should leave non-image URLs intact in pulled emails", async () => {
		globalThis.fetch = mock(async (input: Request | string) => {
			const url = parseUrl(input);

			if (url.pathname.includes("/automations"))
				return jsonResponse({ results: [], count: 0 });
			if (url.pathname.includes("/newsletters"))
				return jsonResponse({ results: [], count: 0 });
			if (url.pathname.includes("/snippets"))
				return jsonResponse({ results: [], count: 0 });
			if (url.pathname === "/images")
				return jsonResponse({ results: [], count: 0 });

			if (url.pathname === "/emails") {
				return jsonResponse({
					results: [
						{
							id: "email_2",
							subject: "Links Email",
							slug: "links-email",
							body: "Visit ![logo](https://other-cdn.com/logo.png) for more",
						},
					],
					count: 1,
				});
			}

			return jsonResponse({});
		}) as unknown as typeof fetch;

		render(
			<Pull
				baseUrl="https://api.buttondown.com"
				apiKey="test-key"
				directory={tempDir}
			/>,
		);

		await delay(1000);

		const emailContent = await readFile(
			path.join(tempDir, "emails", "links-email.md"),
			"utf8",
		);
		expect(emailContent).toContain("https://other-cdn.com/logo.png");
	});

	test("should handle pull with multiple images", async () => {
		globalThis.fetch = mock(async (input: Request | string) => {
			const url = parseUrl(input);

			if (url.pathname.includes("/automations"))
				return jsonResponse({ results: [], count: 0 });
			if (url.pathname.includes("/newsletters"))
				return jsonResponse({ results: [], count: 0 });
			if (url.pathname.includes("/snippets"))
				return jsonResponse({ results: [], count: 0 });

			if (url.pathname === "/images") {
				return jsonResponse({
					results: [
						{
							id: "img_a",
							image: "https://assets.buttondown.email/images/one.png",
							creation_date: "2025-01-01",
						},
						{
							id: "img_b",
							image: "https://assets.buttondown.email/images/two.jpg",
							creation_date: "2025-01-02",
						},
					],
					count: 2,
				});
			}

			if (url.hostname === "assets.buttondown.email") {
				const filename = path.basename(url.pathname);
				return new Response(Buffer.from(`data-${filename}`), { status: 200 });
			}

			if (url.pathname === "/emails") {
				return jsonResponse({
					results: [
						{
							id: "email_3",
							subject: "Multi Image",
							slug: "multi-image",
							body: "![a](https://assets.buttondown.email/images/one.png) and ![b](https://assets.buttondown.email/images/two.jpg)",
						},
					],
					count: 1,
				});
			}

			return jsonResponse({});
		}) as unknown as typeof fetch;

		render(
			<Pull
				baseUrl="https://api.buttondown.com"
				apiKey="test-key"
				directory={tempDir}
			/>,
		);

		await delay(1000);

		const emailContent = await readFile(
			path.join(tempDir, "emails", "multi-image.md"),
			"utf8",
		);
		expect(emailContent).toContain("../media/one.png");
		expect(emailContent).toContain("../media/two.jpg");
		expect(emailContent).not.toContain("https://assets.buttondown.email");

		const state = JSON.parse(
			await readFile(path.join(tempDir, ".buttondown.json"), "utf8"),
		);
		expect(Object.keys(state.syncedImages)).toHaveLength(2);
	});
});
