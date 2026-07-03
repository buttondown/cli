import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { components } from "../lib/openapi.js";
import type { SyncedImage } from "./state.js";
import {
	type Configuration,
	constructClient,
	emptyResult,
	type OperationResult,
	paginatedList,
	type Resource,
	type ResourceGroup,
	throwIfError,
} from "./types.js";
import { errorMessage, sanitizeFilenameStem } from "./util.js";

type Image = components["schemas"]["Image"];

const EXTENSION_TO_MIME: Record<string, string> = {
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
};

export async function uploadImage(
	configuration: Configuration,
	imagePath: string,
): Promise<{ id: string; url: string; filename: string }> {
	const buffer = await readFile(imagePath);
	const filename = path.basename(imagePath);
	const ext = path.extname(imagePath).toLowerCase();
	const mimeType = EXTENSION_TO_MIME[ext] || "application/octet-stream";

	const formData = new FormData();
	formData.append(
		"image",
		new Blob([new Uint8Array(buffer)], { type: mimeType }),
		filename,
	);

	const response = await constructClient(configuration).post("/images", {
		body: formData,
	});

	throwIfError(response, `Failed to upload image ${filename}`);

	return {
		id: response.data.id,
		url: response.data.image,
		filename,
	};
}

/**
 * A safe local filename for a remote image: derived from the URL's pathname
 * (never the query string) and sanitized so a hostile URL can't escape the
 * media directory.
 */
export function remoteImageFilename(image: Image): string {
	let base: string;
	try {
		base = path.posix.basename(new URL(image.image).pathname);
	} catch {
		base = path.posix.basename(image.image.split("?")[0]);
	}
	try {
		base = decodeURIComponent(base);
	} catch {
		// keep the encoded form if it isn't valid percent-encoding
	}
	return sanitizeFilenameStem(base, image.id);
}

/**
 * Downloads remote images into `media/`, returning sync-state entries for
 * the successful ones only — a failed download must stay unrecorded so it is
 * retried on the next pull rather than referenced as a file that doesn't
 * exist. Filename collisions between distinct images get an id prefix so one
 * image can never silently overwrite (or masquerade as) another.
 */
export async function downloadImages(
	images: Image[],
	configuration: Configuration,
	takenFilenames: Iterable<string> = [],
): Promise<{ synced: SyncedImage[]; result: OperationResult }> {
	const mediaDir = path.join(configuration.directory, "media");
	await mkdir(mediaDir, { recursive: true });

	const used = new Set(takenFilenames);
	const synced: SyncedImage[] = [];
	const result = emptyResult();

	for (const image of images) {
		let filename = remoteImageFilename(image);
		if (used.has(filename)) {
			filename = `${image.id.slice(0, 8)}-${filename}`;
		}

		try {
			const response = await fetch(image.image);
			if (!response.ok) {
				result.failed++;
				result.errors.push(
					`Failed to download ${image.image}: HTTP ${response.status}`,
				);
				continue;
			}
			const arrayBuffer = await response.arrayBuffer();
			await writeFile(path.join(mediaDir, filename), Buffer.from(arrayBuffer));
			used.add(filename);
			synced.push({
				id: image.id,
				localPath: path.posix.join("media", filename),
				url: image.image,
				filename,
			});
			result.created++;
		} catch (error) {
			result.failed++;
			result.errors.push(
				`Failed to download ${image.image}: ${errorMessage(error)}`,
			);
		}
	}

	return { synced, result };
}

export const REMOTE_IMAGES_RESOURCE: Resource<Image[], Image[]> = {
	get: (configuration) =>
		paginatedList<Image>("Failed to fetch images", (page, pageSize) =>
			constructClient(configuration).get("/images", {
				params: { query: { page, page_size: pageSize } },
			}),
		),
	// Bulk image upload not supported via API; uploads happen one-at-a-time
	// through the standalone uploadImage function.
	async set(): Promise<OperationResult> {
		return emptyResult();
	},
	serialize: (d) => d,
	deserialize: (d) => d,
};

export const LOCAL_IMAGES_RESOURCE: Resource<Image[], Buffer[]> = {
	async get() {
		return [];
	},
	async set(value, configuration) {
		const { result } = await downloadImages(value, configuration);
		return result;
	},
	serialize: () => [],
	deserialize: () => [],
};

export const IMAGES_RESOURCE: ResourceGroup<Image[], Image[], Buffer[]> = {
	name: "images",
	remote: REMOTE_IMAGES_RESOURCE,
	local: LOCAL_IMAGES_RESOURCE,
};
