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
import { stableStringify, toPosixPath } from "./util.js";

type Email = components["schemas"]["Email"];

/**
 * The editor mode ("plaintext" = markdown, "fancy" = HTML) is expressed by
 * the API as a comment prefixed to the body. Locally we round-trip it as an
 * explicit frontmatter field so pushing never silently flips an email's
 * format.
 */
export type LocalEmail = Partial<Email> & { editor_mode?: string };

export interface RelativeImageReference {
	match: string;
	altText: string;
	relativePath: string;
	index: number;
}

export type FrontMatterFields = Pick<
	Email,
	| "id"
	| "subject"
	| "email_type"
	| "status"
	| "metadata"
	| "slug"
	| "publish_date"
	| "description"
	| "image"
	| "canonical_url"
	| "secondary_id"
	| "filters"
	| "commenting_mode"
	| "related_email_ids"
	| "featured"
>;

export const FRONT_MATTER_FIELDS: (keyof FrontMatterFields)[] = [
	"id",
	"subject",
	"email_type",
	"status",
	"metadata",
	"slug",
	"publish_date",
	"description",
	"image",
	"canonical_url",
	"secondary_id",
	"filters",
	"commenting_mode",
	"related_email_ids",
	"featured",
];

export const FRONT_MATTER_FIELD_TO_DEFAULT_VALUE: {
	[K in keyof FrontMatterFields]?: FrontMatterFields[K];
} = {
	email_type: "public",
	featured: false,
	commenting_mode: "enabled",
	filters: {
		filters: [],
		groups: [],
		predicate: "and",
	},
	related_email_ids: [],
};

const EDITOR_MODE_PATTERN = /<!-- buttondown-editor-mode: ([a-z]+) -->/g;

export function editorModeFromBody(
	body: string | null | undefined,
): string | undefined {
	if (!body) return undefined;
	const match = new RegExp(EDITOR_MODE_PATTERN).exec(body);
	return match?.[1];
}

function stripEditorModeSigils(body: string): string {
	return body.replace(new RegExp(EDITOR_MODE_PATTERN), "");
}

/**
 * Deserialize markdown content into email data
 */
export function deserialize(content: string): {
	email: LocalEmail;
	isValid: boolean;
	error?: string;
} {
	const parsed = parseFrontmatter(content);
	if (!parsed.ok) {
		return { email: { body: content }, isValid: false, error: parsed.error };
	}

	const email: LocalEmail = {
		body: parsed.body.trim(),
	};

	for (const field of FRONT_MATTER_FIELDS) {
		const value = parsed.fields[field];
		// Keep explicit falsy values (featured: false, secondary_id: 0) — they
		// are meaningful and must survive the round-trip to be pushable.
		if (value !== undefined && value !== null) {
			email[field] = value as never;
		}
	}

	if (typeof parsed.fields.editor_mode === "string") {
		email.editor_mode = parsed.fields.editor_mode;
	}

	const attachments = parsed.fields.attachments;
	if (typeof attachments === "string") {
		email.attachments = attachments
			.split("\n")
			.map((line) => line.trim().replace(/^- /, ""))
			.filter(Boolean);
	} else if (Array.isArray(attachments)) {
		email.attachments = attachments;
	}

	return { email, isValid: true };
}

const isEmptyish = (value: unknown): boolean =>
	value === null ||
	value === undefined ||
	value === "" ||
	JSON.stringify(value) === "{}" ||
	JSON.stringify(value) === "[]";

const equalsDefault = (
	field: keyof FrontMatterFields,
	value: unknown,
): boolean =>
	field in FRONT_MATTER_FIELD_TO_DEFAULT_VALUE &&
	stableStringify(value) ===
		stableStringify(FRONT_MATTER_FIELD_TO_DEFAULT_VALUE[field]);

/**
 * Serialize email data into markdown content. The editor-mode sigil is
 * lifted out of the body into an `editor_mode` frontmatter field so files
 * stay readable while the mode still round-trips.
 */
export function serialize(email: LocalEmail): string {
	const { body, editor_mode, ...rest } = email;

	const cleanedBody = stripEditorModeSigils(body ?? "");
	const effectiveEditorMode = editor_mode ?? editorModeFromBody(body);

	const restObject = Object.fromEntries(
		Object.entries(rest).filter(
			([field, value]) =>
				FRONT_MATTER_FIELDS.includes(field as keyof FrontMatterFields) &&
				!isEmptyish(value) &&
				!equalsDefault(field as keyof FrontMatterFields, value),
		),
	);
	if (effectiveEditorMode) {
		restObject.editor_mode = effectiveEditorMode;
	}
	return composeFrontmatterDocument(restObject, cleanedBody);
}

/**
 * Canonical, order-independent representation used to decide whether a local
 * email differs from its remote counterpart. Applies frontmatter defaults to
 * both sides (a file omitting `featured` means `featured: false`), trims
 * bodies, and compares the effective editor mode — so semantically equal
 * emails never generate a PATCH, regardless of API key order or trailing
 * whitespace.
 */
export function canonicalizeForDiff(email: LocalEmail): string {
	const canonical: Record<string, unknown> = {};
	for (const field of FRONT_MATTER_FIELDS) {
		const value = email[field] ?? FRONT_MATTER_FIELD_TO_DEFAULT_VALUE[field];
		if (isEmptyish(value)) continue;
		canonical[field] = value;
	}
	canonical.body = stripEditorModeSigils(email.body ?? "").trim();
	canonical.editor_mode =
		email.editor_mode ?? editorModeFromBody(email.body) ?? null;
	return stableStringify(canonical);
}

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Ranges of the content occupied by fenced code blocks; image references
 * inside them are documentation, not uploadable files.
 */
function fencedCodeRanges(content: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const linePattern = /^.*$/gm;
	let fenceStart: number | null = null;
	let fenceMarker = "";
	for (const line of content.matchAll(linePattern)) {
		const trimmed = line[0].trimStart();
		const marker = trimmed.startsWith("```")
			? "```"
			: trimmed.startsWith("~~~")
				? "~~~"
				: null;
		if (!marker) continue;
		if (fenceStart === null) {
			fenceStart = line.index;
			fenceMarker = marker;
		} else if (marker === fenceMarker) {
			ranges.push([fenceStart, line.index + line[0].length]);
			fenceStart = null;
		}
	}
	if (fenceStart !== null) {
		ranges.push([fenceStart, content.length]);
	}
	return ranges;
}

// Path stops at whitespace or ")"; an optional quoted title and <>-wrapped
// paths are handled explicitly so titles never end up inside the path.
const IMAGE_REFERENCE_PATTERN =
	/!\[([^\]]*)\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;

export function findRelativeImageReferences(
	content: string,
): RelativeImageReference[] {
	const results: RelativeImageReference[] = [];
	const masked = fencedCodeRanges(content);
	const regex = new RegExp(IMAGE_REFERENCE_PATTERN);

	for (const match of content.matchAll(regex)) {
		const [fullMatch, altText, rawPath] = match;
		if (
			masked.some(([start, end]) => match.index >= start && match.index < end)
		) {
			continue;
		}
		const imagePath =
			rawPath.startsWith("<") && rawPath.endsWith(">")
				? rawPath.slice(1, -1)
				: rawPath;
		// Only bare relative paths are local files: URLs, data:/mailto: URIs,
		// protocol-relative and absolute paths, and anchors are left alone.
		if (
			SCHEME_PATTERN.test(imagePath) ||
			imagePath.startsWith("//") ||
			imagePath.startsWith("/") ||
			imagePath.startsWith("#") ||
			imagePath === ""
		) {
			continue;
		}
		results.push({
			match: fullMatch,
			altText,
			relativePath: imagePath,
			index: match.index,
		});
	}

	return results;
}

export function replaceImageReference(
	content: string,
	originalReference: string,
	newUrl: string,
	altText: string,
): string {
	const newReference = `![${altText}](${newUrl})`;
	// A function replacement keeps "$&"-style patterns in alt text or URLs
	// from being interpreted as replacement directives.
	return content.replace(originalReference, () => newReference);
}

type SyncedImageInfo = { localPath: string; url: string };

/*
  Replaces the relative image references in the content with the corresponding
  URLs from the syncedImages object. `baseDir` is the directory of the file the
  content came from, since relative references are relative to their own file.
*/
export function resolveRelativeImageReferences(
	content: string,
	baseDir: string,
	syncedImages: Record<string, SyncedImageInfo>,
): string {
	const references = findRelativeImageReferences(content);
	let processedContent = content;

	// Replace back-to-front by index so earlier replacements can't shift (or
	// collide with) later ones.
	for (const ref of [...references].reverse()) {
		const absolutePath = path.resolve(baseDir, ref.relativePath);
		const matchingImage = Object.values(syncedImages).find(
			(img) => path.resolve(img.localPath) === absolutePath,
		);

		if (matchingImage) {
			const newReference = `![${ref.altText}](${matchingImage.url})`;
			processedContent =
				processedContent.slice(0, ref.index) +
				newReference +
				processedContent.slice(ref.index + ref.match.length);
		}
	}

	return processedContent;
}

const ABSOLUTE_IMAGE_URL_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;

export function convertAbsoluteToRelativeImages(
	content: string,
	emailDir: string,
	syncedImages: Record<string, SyncedImageInfo>,
): string {
	const regex = new RegExp(ABSOLUTE_IMAGE_URL_REGEX);
	return content.replace(regex, (match, altText, imageUrl) => {
		const syncedImage = Object.values(syncedImages).find(
			(img) => img.url === imageUrl,
		);

		if (syncedImage) {
			const relativePath = toPosixPath(
				path.relative(emailDir, syncedImage.localPath),
			);
			return `![${altText}](${relativePath})`;
		}

		return match;
	});
}

/**
 * Fills in the documented defaults for omitted frontmatter fields so that a
 * file with no `featured:` line genuinely means `featured: false` on the
 * server, and re-expresses the editor mode as the body sigil the API expects.
 */
function prepareForPush(email: LocalEmail): Partial<Email> {
	const { editor_mode, ...rest } = email;
	const prepared: Partial<Email> = { ...rest };
	for (const [field, defaultValue] of Object.entries(
		FRONT_MATTER_FIELD_TO_DEFAULT_VALUE,
	)) {
		if (prepared[field as keyof FrontMatterFields] === undefined) {
			(prepared as Record<string, unknown>)[field] = defaultValue;
		}
	}
	const mode = editor_mode ?? editorModeFromBody(email.body);
	if (mode && email.body && !email.body.includes("buttondown-editor-mode")) {
		prepared.body = `<!-- buttondown-editor-mode: ${mode} -->${email.body}`;
	}
	return prepared;
}

export const REMOTE_EMAILS_RESOURCE: Resource<Email[], Email[]> = {
	get: (configuration) =>
		paginatedList<Email>("Failed to fetch emails", (page, pageSize) =>
			constructClient(configuration).get("/emails", {
				params: {
					query: {
						page,
						page_size: pageSize,
					},
				},
			}),
		),
	set: (value, configuration, hooks?: SetHooks) =>
		bulkSet(
			value as LocalEmail[],
			{
				label: (email) => email.slug || email.subject || email.id || "(email)",
				update: async (email) => {
					const result = await constructClient(configuration).patch(
						"/emails/{id}",
						{
							params: { path: { id: email.id } },
							body: omit(prepareForPush(email), [
								"absolute_url",
								"analytics",
								"callouts",
								"creation_date",
								"id",
								"modification_date",
								"source",
							]),
						},
					);
					throwIfError(result, `Failed to update email ${email.id}`);
				},
				create: async (email) => {
					const { attachments, ...rest } = prepareForPush(email);
					const result = await constructClient(configuration).post("/emails", {
						body: {
							...omit(rest, [
								"absolute_url",
								"analytics",
								"callouts",
								"creation_date",
								"id",
								"modification_date",
								"source",
								"suppression_reason",
								"template",
							]),
							attachments: attachments ?? undefined,
							subject: email.subject || "",
						},
					});
					throwIfError(
						result,
						`Failed to create email "${email.subject ?? ""}"`,
					);
					return result.data?.id;
				},
			},
			hooks,
		),
	serialize: (d) => d,
	deserialize: (d) => d,
};

export type LocalEmailEntry = LocalFileEntry<LocalEmail>;

export function readLocalEmails(configuration: Configuration): Promise<{
	entries: LocalEmailEntry[];
	skipped: SkippedFile[];
}> {
	return readLocalFiles<LocalEmail>({
		directory: configuration.directory,
		name: "emails",
		pattern: "**/*.md",
		parse: (content) => {
			const result = deserialize(content);
			return result.isValid
				? { value: result.email }
				: { error: result.error ?? "Invalid email file" };
		},
	});
}

export const LOCAL_EMAILS_RESOURCE: Resource<Email[], string[]> = {
	async get(configuration) {
		const { entries } = await readLocalEmails(configuration);
		return entries.map((entry) => entry.value as Email);
	},
	async set(value, configuration) {
		const { entries } = await readLocalEmails(configuration);
		return writeLocalFiles({
			directory: configuration.directory,
			name: "emails",
			extension: ".md",
			items: value,
			idOf: (email) => email.id,
			stemOf: (email) => email.slug,
			serialize,
			existingPathById: pathsById(entries, (email) => email.id),
		});
	},
	serialize: (emails) => emails.map((e) => serialize(e)),
	deserialize: (contents) => contents.map((s) => deserialize(s).email as Email),
};

export const EMAILS_RESOURCE: ResourceGroup<Email[], Email[], string[]> = {
	name: "emails",
	remote: REMOTE_EMAILS_RESOURCE,
	local: LOCAL_EMAILS_RESOURCE,
};
