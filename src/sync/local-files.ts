import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { emptyResult, type OperationResult } from "./types.js";
import { sanitizeFilenameStem } from "./util.js";

export type LocalFileEntry<T> = {
	value: T;
	/** Absolute path of the file the value came from. */
	filePath: string;
};

export type SkippedFile = { file: string; error: string };

/**
 * Reads every file matching `pattern` under `<directory>/<name>`, keeping
 * track of which file each parsed value came from (for image resolution and
 * id write-back) and which files were skipped as invalid (so the user hears
 * about them instead of silently losing them).
 */
export async function readLocalFiles<T>(options: {
	directory: string;
	name: string;
	pattern: string;
	parse: (
		content: string,
		filePath: string,
	) => { value: T } | { error: string };
}): Promise<{ entries: LocalFileEntry<T>[]; skipped: SkippedFile[] }> {
	const resourceDir = path.join(options.directory, options.name);
	const files = await fg(options.pattern, {
		cwd: resourceDir,
		absolute: false,
	});

	const entries: LocalFileEntry<T>[] = [];
	const skipped: SkippedFile[] = [];
	for (const file of files.sort()) {
		const filePath = path.resolve(resourceDir, file);
		const content = await readFile(filePath, "utf8");
		const result = options.parse(content, filePath);
		if ("value" in result) {
			entries.push({ value: result.value, filePath });
		} else {
			skipped.push({
				file: path.join(options.name, file),
				error: result.error,
			});
		}
	}

	return { entries, skipped };
}

/** Existing file per resource id, for rename detection during writes. */
export function pathsById<T>(
	entries: LocalFileEntry<T>[],
	idOf: (value: T) => string | undefined,
): Map<string, string> {
	return new Map(
		entries.flatMap((entry) => {
			const id = idOf(entry.value);
			return id ? [[id, entry.filePath] as const] : [];
		}),
	);
}

/**
 * Writes pulled resources into `<directory>/<name>`, one file per item.
 * Filename stems are remote-controlled (slugs, identifiers, names), so they
 * are sanitized and collision-suffixed instead of silently overwriting each
 * other. A renamed item's previous file is removed only after every write
 * lands, so a stem swap between two items can't delete a freshly written
 * file.
 */
export async function writeLocalFiles<T>(options: {
	directory: string;
	name: string;
	extension: string;
	items: T[];
	idOf: (item: T) => string | undefined;
	stemOf: (item: T) => string | null | undefined;
	serialize: (item: T) => string;
	existingPathById: Map<string, string>;
}): Promise<OperationResult> {
	const resourceDir = path.join(options.directory, options.name);
	await mkdir(resourceDir, { recursive: true });

	const result = emptyResult();
	const usedFilenames = new Set<string>();
	const writes: Array<{ item: T; filePath: string; previousPath?: string }> =
		[];
	for (const item of options.items) {
		const id = options.idOf(item);
		const fallback = id || options.name;
		let stem = sanitizeFilenameStem(options.stemOf(item), fallback);
		if (usedFilenames.has(stem)) {
			stem = sanitizeFilenameStem(`${stem}-${fallback.slice(0, 8)}`, fallback);
		}
		usedFilenames.add(stem);
		writes.push({
			item,
			filePath: path.resolve(resourceDir, `${stem}${options.extension}`),
			previousPath: id ? options.existingPathById.get(id) : undefined,
		});
	}

	const targetPaths = new Set(writes.map((w) => w.filePath));
	for (const write of writes) {
		await writeFile(write.filePath, options.serialize(write.item));
		if (write.previousPath) {
			result.updated++;
		} else {
			result.created++;
		}
	}
	for (const write of writes) {
		if (
			write.previousPath &&
			write.previousPath !== write.filePath &&
			!targetPaths.has(write.previousPath)
		) {
			await unlink(write.previousPath);
		}
	}
	return result;
}
