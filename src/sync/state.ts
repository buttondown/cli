import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SyncedImage = {
	id: string;
	localPath: string;
	url: string;
	filename: string;
};

export type SyncState = {
	syncedImages: Record<string, SyncedImage>;
};

const SYNC_STATE_FILE = ".buttondown.json";

const DEFAULT_STATE: SyncState = { syncedImages: {} };

export async function readSyncState(directory: string): Promise<SyncState> {
	try {
		const filePath = path.join(directory, SYNC_STATE_FILE);
		const content = await readFile(filePath, "utf8");
		return { ...DEFAULT_STATE, ...JSON.parse(content) };
	} catch {
		return { ...DEFAULT_STATE };
	}
}

export async function writeSyncState(
	directory: string,
	state: SyncState,
): Promise<void> {
	const filePath = path.join(directory, SYNC_STATE_FILE);
	await writeFile(filePath, JSON.stringify(state, null, 2));
}
