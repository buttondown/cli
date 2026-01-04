import { describe, expect, it } from "bun:test";
import { LOCAL_IMAGES_RESOURCE, REMOTE_IMAGES_RESOURCE } from "./images.js";

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
});
