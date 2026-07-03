import path from "node:path";

/**
 * JSON.stringify with recursively sorted object keys, so semantically equal
 * objects compare equal regardless of key insertion order (local YAML order
 * vs. API response order).
 */
export function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, v]) => [k, sortKeysDeep(v)]),
		);
	}
	return value;
}

/**
 * Remote-controlled values (slugs, identifiers, names, URL basenames) become
 * local filenames; strip anything that could escape the target directory or
 * produce an unusable name, falling back to a known-safe stem (typically the
 * resource id).
 */
export function sanitizeFilenameStem(
	stem: string | null | undefined,
	fallback: string,
): string {
	const cleaned = (stem ?? "")
		.replace(/[/\\]/g, "-")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
		.replace(/[\u0000-\u001f]/g, "")
		.replace(/^\.+/, "")
		.trim();
	if (!cleaned || cleaned === "." || cleaned === "..") {
		return fallback;
	}
	return cleaned;
}

/** Markdown links must use forward slashes even when generated on Windows. */
export function toPosixPath(p: string): string {
	return p.split(path.sep).join("/");
}

/** Human-readable message for a caught unknown. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
