import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSyncState, writeSyncState } from "./state.js";

describe("state", () => {
	let tempDir: string;

	afterEach(async () => {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	describe("readSyncState", () => {
		it("should return default state when no file exists", async () => {
			tempDir = await mkdtemp(path.join(tmpdir(), "state-test-"));
			const state = await readSyncState(tempDir);
			expect(state).toEqual({ syncedImages: {} });
		});

		it("should read existing state from .buttondown.json", async () => {
			tempDir = await mkdtemp(path.join(tmpdir(), "state-test-"));
			const existing = {
				syncedImages: {
					img1: {
						id: "img1",
						localPath: "/project/media/photo.png",
						url: "https://assets.buttondown.email/images/photo.png",
						filename: "photo.png",
					},
				},
			};
			await Bun.write(
				path.join(tempDir, ".buttondown.json"),
				JSON.stringify(existing),
			);

			const state = await readSyncState(tempDir);
			expect(state).toEqual(existing);
		});

		it("should merge with defaults for partial state", async () => {
			tempDir = await mkdtemp(path.join(tmpdir(), "state-test-"));
			await Bun.write(path.join(tempDir, ".buttondown.json"), "{}");

			const state = await readSyncState(tempDir);
			expect(state).toEqual({ syncedImages: {} });
		});
	});

	describe("writeSyncState", () => {
		it("should write state to .buttondown.json", async () => {
			tempDir = await mkdtemp(path.join(tmpdir(), "state-test-"));
			const state = {
				syncedImages: {
					img1: {
						id: "img1",
						localPath: "/project/media/photo.png",
						url: "https://assets.buttondown.email/images/photo.png",
						filename: "photo.png",
					},
				},
			};

			await writeSyncState(tempDir, state);

			const content = await readFile(
				path.join(tempDir, ".buttondown.json"),
				"utf8",
			);
			expect(JSON.parse(content)).toEqual(state);
		});

		it("should roundtrip through read/write", async () => {
			tempDir = await mkdtemp(path.join(tmpdir(), "state-test-"));
			const state = {
				syncedImages: {
					img1: {
						id: "img1",
						localPath: "/project/media/one.png",
						url: "https://example.com/one.png",
						filename: "one.png",
					},
					img2: {
						id: "img2",
						localPath: "/project/media/two.jpg",
						url: "https://example.com/two.jpg",
						filename: "two.jpg",
					},
				},
			};

			await writeSyncState(tempDir, state);
			const read = await readSyncState(tempDir);

			expect(read).toEqual(state);
		});
	});
});
