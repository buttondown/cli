import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./util.js";

export type SyncedImage = {
	id: string;
	/** POSIX-style path relative to the sync directory (e.g. "media/foo.png"). */
	localPath: string;
	url: string;
	filename: string;
};

export type SyncState = {
	syncedImages: Record<string, SyncedImage>;
};

const SYNC_STATE_FILE = ".buttondown.json";

const DEFAULT_STATE: SyncState = { syncedImages: {} };

/** Resolves a synced image's stored (directory-relative) path to an absolute one. */
export function resolveSyncedImagePath(
	directory: string,
	image: SyncedImage,
): string {
	return path.resolve(directory, image.localPath);
}

/**
 * Older CLI versions stored absolute paths, which broke as soon as the
 * comparison site used a different cwd or the directory moved. Normalize to
 * directory-relative on read so state written by any version keeps working.
 */
function normalizeImage(directory: string, image: SyncedImage): SyncedImage {
	if (!path.isAbsolute(image.localPath)) {
		return { ...image, localPath: toPosixPath(image.localPath) };
	}
	const relative = path.relative(path.resolve(directory), image.localPath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return image;
	}
	return { ...image, localPath: toPosixPath(relative) };
}

export async function readSyncState(directory: string): Promise<SyncState> {
	const filePath = path.join(directory, SYNC_STATE_FILE);
	let content: string;
	try {
		content = await readFile(filePath, "utf8");
	} catch {
		return { syncedImages: { ...DEFAULT_STATE.syncedImages } };
	}
	try {
		const parsed = { ...DEFAULT_STATE, ...JSON.parse(content) } as SyncState;
		return {
			...parsed,
			syncedImages: Object.fromEntries(
				Object.entries(parsed.syncedImages ?? {}).map(([id, image]) => [
					id,
					normalizeImage(directory, image),
				]),
			),
		};
	} catch {
		// Treating corrupt state as empty would silently re-upload every image
		// as a server-side duplicate; make the user decide instead.
		throw new Error(
			`Sync state file ${filePath} is corrupted. Fix or delete it, then re-run 'buttondown pull' before pushing.`,
		);
	}
}

export async function writeSyncState(
	directory: string,
	state: SyncState,
): Promise<void> {
	await mkdir(directory, { recursive: true });
	const filePath = path.join(directory, SYNC_STATE_FILE);
	await writeFile(filePath, JSON.stringify(state, null, 2));
}
