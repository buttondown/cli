import path from "node:path";
import type { components } from "../lib/openapi.js";
import { composeFrontmatterDocument, parseFrontmatter } from "./frontmatter.js";
import {
	type LocalFileEntry,
	pathsById,
	readLocalFiles,
	type SkippedFile,
	writeLocalFiles,
} from "./local-files.js";
import {
	bulkSet,
	type Configuration,
	constructClient,
	omit,
	paginatedList,
	type Resource,
	type ResourceGroup,
	type SetHooks,
	throwIfError,
} from "./types.js";
import { stableStringify } from "./util.js";

type Snippet = components["schemas"]["Snippet"];

type FrontMatterFields = Pick<Snippet, "id" | "name">;

const FRONT_MATTER_FIELDS: (keyof FrontMatterFields)[] = ["id", "name"];

export function deserialize(content: string): {
	snippet: Partial<Snippet>;
	isValid: boolean;
	error?: string;
} {
	const parsed = parseFrontmatter(content);
	if (!parsed.ok) {
		return { snippet: { content }, isValid: false, error: parsed.error };
	}

	const snippet: Partial<Snippet> = {
		content: parsed.body.trim(),
	};

	for (const field of FRONT_MATTER_FIELDS) {
		const value = parsed.fields[field];
		if (value !== undefined && value !== null) {
			snippet[field] = value as never;
		}
	}

	return { snippet, isValid: true };
}

export function serialize(snippet: Partial<Snippet>): string {
	const { content, ...rest } = snippet;

	const restObject = Object.fromEntries(
		Object.entries(rest).filter(
			([field, value]) =>
				value !== null &&
				value !== undefined &&
				value !== "" &&
				FRONT_MATTER_FIELDS.includes(field as keyof FrontMatterFields),
		) as [keyof FrontMatterFields, unknown][],
	);
	return composeFrontmatterDocument(restObject, content ?? "");
}

/**
 * Order-independent representation for change detection. Includes the
 * identifier (derived locally from the filename) so renaming a snippet file
 * is detected and pushed like any other change.
 */
export function canonicalizeForDiff(snippet: Partial<Snippet>): string {
	return stableStringify({
		id: snippet.id ?? null,
		identifier: snippet.identifier ?? null,
		name: snippet.name ?? null,
		content: (snippet.content ?? "").trim(),
	});
}

export const REMOTE_SNIPPETS_RESOURCE: Resource<Snippet[], Snippet[]> = {
	get: (configuration) =>
		paginatedList<Snippet>("Failed to fetch snippets", (page, pageSize) =>
			constructClient(configuration).get("/snippets", {
				params: { query: { page, page_size: pageSize } },
			}),
		),
	set: (value, configuration, hooks?: SetHooks) =>
		bulkSet(
			value,
			{
				label: (snippet) => snippet.identifier || snippet.name || "(snippet)",
				update: async (snippet) => {
					const result = await constructClient(configuration).patch(
						"/snippets/{id}",
						{
							params: { path: { id: snippet.id } },
							body: omit(snippet, ["creation_date", "id", "reference_count"]),
						},
					);
					throwIfError(result, `Failed to update snippet ${snippet.id}`);
				},
				create: async (snippet) => {
					const result = await constructClient(configuration).post(
						"/snippets",
						{
							body: {
								identifier: snippet.identifier || "",
								name: snippet.name || "",
								content: snippet.content || "",
							},
						},
					);
					throwIfError(
						result,
						`Failed to create snippet "${snippet.identifier ?? ""}"`,
					);
					return result.data?.id;
				},
			},
			hooks,
		),
	serialize: (d) => d,
	deserialize: (d) => d,
};

export type LocalSnippetEntry = LocalFileEntry<Partial<Snippet>>;

export function readLocalSnippets(configuration: Configuration): Promise<{
	entries: LocalSnippetEntry[];
	skipped: SkippedFile[];
}> {
	return readLocalFiles<Partial<Snippet>>({
		directory: configuration.directory,
		name: "snippets",
		pattern: "**/*.md",
		parse: (content, filePath) => {
			const result = deserialize(content);
			if (!result.isValid) {
				return { error: result.error ?? "Invalid snippet file" };
			}
			// The filename is the snippet's identifier.
			const identifier = path.basename(filePath, ".md");
			return { value: { identifier, ...result.snippet } };
		},
	});
}

export const LOCAL_SNIPPETS_RESOURCE: Resource<Snippet[], string[]> = {
	async get(configuration) {
		const { entries } = await readLocalSnippets(configuration);
		return entries.map((entry) => entry.value as Snippet);
	},
	async set(value, configuration) {
		const { entries } = await readLocalSnippets(configuration);
		return writeLocalFiles({
			directory: configuration.directory,
			name: "snippets",
			extension: ".md",
			items: value,
			idOf: (snippet) => snippet.id,
			stemOf: (snippet) => snippet.identifier,
			serialize,
			existingPathById: pathsById(entries, (snippet) => snippet.id),
		});
	},
	serialize: (snippets) => snippets.map((s) => serialize(s)),
	deserialize: (contents) =>
		contents.map((s) => deserialize(s).snippet as Snippet),
};

export const SNIPPETS_RESOURCE: ResourceGroup<Snippet[], Snippet[], string[]> =
	{
		name: "snippets",
		remote: REMOTE_SNIPPETS_RESOURCE,
		local: LOCAL_SNIPPETS_RESOURCE,
	};
