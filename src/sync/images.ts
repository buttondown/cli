import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { components } from "../lib/openapi.js";
import {
	constructClient,
	type OperationResult,
	PAGE_SIZE,
	type Resource,
	type ResourceGroup,
} from "./types.js";

type Image = components["schemas"]["Image"];

export const REMOTE_IMAGES_RESOURCE: Resource<Image[], Image[]> = {
	async get(configuration) {
		const images: Image[] = [];
		let page = 1;
		let hasMore = true;

		while (hasMore) {
			const response = await constructClient(configuration).get("/images", {
				params: {
					query: {
						page,
						page_size: PAGE_SIZE,
					},
				},
			});

			if (response.data?.results) {
				images.push(...response.data.results);
				hasMore = response.data.results.length === PAGE_SIZE;
			} else {
				hasMore = false;
			}
			page++;
		}

		return images;
	},
	async set(): Promise<OperationResult> {
		// Bulk image upload not supported via API
		return {
			updated: 0,
			created: 0,
			deleted: 0,
			failed: 0,
		};
	},
	serialize: (d) => d,
	deserialize: (d) => d,
};

export const LOCAL_IMAGES_RESOURCE: Resource<Image[], Buffer[]> = {
	async get() {
		return [];
	},
	async set(value, configuration) {
		const mediaDir = path.join(configuration.directory, "media");
		await mkdir(mediaDir, { recursive: true });
		for (const image of value) {
			const filename = path.basename(image.image);
			const localPath = path.join(mediaDir, filename);
			const response = await fetch(image.image);
			const arrayBuffer = await response.arrayBuffer();
			await writeFile(localPath, Buffer.from(arrayBuffer));
		}
		return {
			updated: 0,
			created: 0,
			deleted: 0,
			failed: 0,
		};
	},
	serialize: () => [],
	deserialize: () => [],
};

export const IMAGES_RESOURCE: ResourceGroup<Image[], Image[], Buffer[]> = {
	name: "images",
	remote: REMOTE_IMAGES_RESOURCE,
	local: LOCAL_IMAGES_RESOURCE,
};
