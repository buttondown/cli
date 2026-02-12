import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	LOCAL_IMAGES_RESOURCE,
	REMOTE_IMAGES_RESOURCE,
	uploadImage,
} from "./images.js";

describe("images", () => {
	describe("REMOTE_IMAGES_RESOURCE", () => {
		it("should have serialize as identity function", () => {
			const images = [
				{
					id: "1",
					image: "https://example.com/img1.png",
					creation_date: "2023-01-01",
				},
				{
					id: "2",
					image: "https://example.com/img2.png",
					creation_date: "2023-01-02",
				},
			];

			const result = REMOTE_IMAGES_RESOURCE.serialize(images);

			expect(result).toEqual(images);
		});

		it("should have deserialize as identity function", () => {
			const images = [
				{
					id: "1",
					image: "https://example.com/img1.png",
					creation_date: "2023-01-01",
				},
				{
					id: "2",
					image: "https://example.com/img2.png",
					creation_date: "2023-01-02",
				},
			];

			const result = REMOTE_IMAGES_RESOURCE.deserialize(images);

			expect(result).toEqual(images);
		});

		it("should return empty result for set (upload not supported)", async () => {
			await REMOTE_IMAGES_RESOURCE.set([], {
				baseUrl: "https://api.buttondown.com",
				apiKey: "test",
				directory: "./test",
			});

			// No error thrown means success - bulk upload returns void
		});
	});

	describe("LOCAL_IMAGES_RESOURCE", () => {
		it("should return empty array for get", async () => {
			const result = await LOCAL_IMAGES_RESOURCE.get({
				baseUrl: "https://api.buttondown.com",
				apiKey: "test",
				directory: "./test",
			});

			expect(result).toEqual([]);
		});

		it("should have serialize return empty array", () => {
			const images = [{ id: "1", image: "https://example.com/img1.png" }];

			// @ts-expect-error - partial image for testing
			const result = LOCAL_IMAGES_RESOURCE.serialize(images);

			expect(result).toEqual([]);
		});

		it("should have deserialize return empty array", () => {
			const buffers = [Buffer.from("test")];

			const result = LOCAL_IMAGES_RESOURCE.deserialize(buffers);

			expect(result).toEqual([]);
		});
	});

	describe("uploadImage", () => {
		let tempDir: string;

		afterEach(async () => {
			if (tempDir) {
				await rm(tempDir, { recursive: true, force: true });
			}
			mock.restore();
		});

		it("should upload an image and return id, url, and filename", async () => {
			tempDir = await mkdtemp(path.join(tmpdir(), "upload-test-"));
			const imagePath = path.join(tempDir, "test.png");
			await writeFile(imagePath, Buffer.from("fake-png-data"));

			const originalFetch = globalThis.fetch;
			globalThis.fetch = mock(async (request: Request) => {
				const body = await request.formData();
				const file = body.get("image") as File;
				expect(file).toBeTruthy();
				expect(file.name).toBe("test.png");
				expect(file.type).toBe("image/png");

				return new Response(
					JSON.stringify({
						id: "img_123",
						image: "https://assets.buttondown.email/images/test.png",
						creation_date: "2025-01-01",
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				);
			}) as unknown as typeof fetch;

			try {
				const result = await uploadImage(
					{
						baseUrl: "https://api.buttondown.com",
						apiKey: "test-key",
						directory: tempDir,
					},
					imagePath,
				);

				expect(result.id).toBe("img_123");
				expect(result.url).toBe(
					"https://assets.buttondown.email/images/test.png",
				);
				expect(result.filename).toBe("test.png");
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it("should throw on upload failure", async () => {
			tempDir = await mkdtemp(path.join(tmpdir(), "upload-test-"));
			const imagePath = path.join(tempDir, "bad.jpg");
			await writeFile(imagePath, Buffer.from("fake-jpg-data"));

			const originalFetch = globalThis.fetch;
			globalThis.fetch = mock(
				async () =>
					new Response(JSON.stringify({ detail: "Bad request" }), {
						status: 400,
						headers: { "content-type": "application/json" },
					}),
			) as unknown as typeof fetch;

			try {
				await expect(
					uploadImage(
						{
							baseUrl: "https://api.buttondown.com",
							apiKey: "test-key",
							directory: tempDir,
						},
						imagePath,
					),
				).rejects.toThrow("Failed to upload image bad.jpg");
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});
});
