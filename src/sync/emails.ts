import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import type { components } from "../lib/openapi.js";
import {
	constructClient,
	type OperationResult,
	PAGE_SIZE,
	type Resource,
	type ResourceGroup,
} from "./types.js";

type Email = components["schemas"]["Email"];

export interface RelativeImageReference {
	match: string;
	altText: string;
	relativePath: string;
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

/**
 * Deserialize markdown content into email data
 */
export function deserialize(content: string): {
	email: Partial<Email>;
	isValid: boolean;
	error?: string;
} {
	const parts = content.split("---");
	if (parts.length < 3) {
		return {
			email: { body: content },
			isValid: false,
			error: "Invalid format (missing frontmatter)",
		};
	}

	const [_, frontmatter, body] = parts;

	const parsedYAML = parseYAML(frontmatter) as Record<string, any>;
	if (Object.keys(parsedYAML).length === 0) {
		return {
			email: { body: content },
			isValid: false,
			error: "Invalid format (missing frontmatter)",
		};
	}

	const email: Partial<Email & FrontMatterFields> = {
		body: body.trim(),
	};

	for (const field of FRONT_MATTER_FIELDS) {
		if (parsedYAML[field]) email[field] = parsedYAML[field];
	}

	if (parsedYAML.attachments) {
		if (typeof parsedYAML.attachments === "string") {
			email.attachments = parsedYAML.attachments
				.split("\n")
				.map((line) => line.trim().replace(/^- /, ""))
				.filter(Boolean);
		} else if (Array.isArray(parsedYAML.attachments)) {
			email.attachments = parsedYAML.attachments;
		}
	}

	return { email, isValid: true };
}

const MARKDOWN_MODE_SIGIL = "<!-- buttondown-editor-mode: plaintext -->";

/**
 * Serialize email data into markdown content.
 * Optionally, this function takes an "external" email object that may have been modified
 * from the original deserialized email object, in order to minimize the number of 'empty' changes (escapement, ordering, etc.)
 */
export function serialize(email: Partial<Email & FrontMatterFields>): string {
	const { body, ...rest } = email;

	const cleanedBody = body?.replace(MARKDOWN_MODE_SIGIL, "");

	const restObject = Object.fromEntries(
		Object.entries(rest).filter(
			([field, value]) =>
				value !== null &&
				value !== undefined &&
				value !== "" &&
				JSON.stringify(value) !== "{}" &&
				JSON.stringify(value) !== "[]" &&
				FRONT_MATTER_FIELDS.includes(field as keyof FrontMatterFields) &&
				JSON.stringify(value) !==
					JSON.stringify(
						FRONT_MATTER_FIELD_TO_DEFAULT_VALUE[
							field as keyof FrontMatterFields
						],
					),
		) as [keyof FrontMatterFields, any][],
	);
	let yamlContent = stringifyYAML(restObject, { indent: 2 });
	// Remove trailing newline to match Bun's YAML.stringify behavior
	yamlContent = yamlContent.endsWith("\n")
		? yamlContent.slice(0, -1)
		: yamlContent;
	// Add trailing space after keys that have nested objects to match Bun's format
	// This regex matches "key:" followed by a newline and indent (indicating nested value)
	yamlContent = yamlContent.replace(/^(\S+):(\n(?: {2}|\t))/gm, "$1: $2");
	return `---\n${yamlContent}\n---\n\n${cleanedBody}`;
}

const RELATIVE_IMAGE_REFERENCE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function findRelativeImageReferences(
	content: string,
): RelativeImageReference[] {
	const results: RelativeImageReference[] = [];
	let match = RELATIVE_IMAGE_REFERENCE_REGEX.exec(content);

	while (match !== null) {
		const [fullMatch, altText, imagePath] = match;

		if (!imagePath.startsWith("http") && !imagePath.startsWith("//")) {
			results.push({
				match: fullMatch,
				altText,
				relativePath: imagePath,
			});
		}
		match = RELATIVE_IMAGE_REFERENCE_REGEX.exec(content);
	}

	return results;
}

export const REMOTE_EMAILS_RESOURCE: Resource<Email[], Email[]> = {
	async get(configuration) {
		const emails: Email[] = [];
		let page = 1;
		let hasMore = true;

		while (hasMore) {
			const response = await constructClient(configuration).get("/emails", {
				params: {
					query: {
						// @ts-expect-error
						page,
						page_size: PAGE_SIZE,
					},
				},
			});

			if (response.data?.results) {
				emails.push(...response.data.results);
				hasMore = response.data.results.length === PAGE_SIZE;
			} else {
				hasMore = false;
			}
			page++;
		}

		return emails;
	},
	async set(value, configuration): Promise<OperationResult> {
		let updated = 0;
		let created = 0;
		const deleted = 0;
		const failed = 0;
		for (const email of value) {
			if (email.id) {
				await constructClient(configuration).patch("/emails/{id}", {
					params: { path: { id: email.id } },
					body: email,
				});
				updated++;
			} else {
				await constructClient(configuration).post("/emails", {
					body: { ...email, subject: email.subject || "" },
				});
				created++;
			}
		}
		return {
			updated: updated,
			created: created,
			deleted: deleted,
			failed: failed,
		};
	},
	serialize: (d) => d,
	deserialize: (d) => d,
};

export const LOCAL_EMAILS_RESOURCE: Resource<Email[], string[]> = {
	async get(configuration) {
		const emailsDir = path.join(configuration.directory, "emails");
		const emailFiles = await fg("**/*.md", {
			cwd: emailsDir,
			absolute: false,
		});

		const emails: Email[] = [];
		for (const emailFile of emailFiles) {
			const content = await readFile(path.join(emailsDir, emailFile), "utf8");
			const result = deserialize(content);
			if (result.isValid) {
				emails.push(result.email as Email);
			}
		}

		return emails;
	},
	async set(value, configuration) {
		const emailsDir = path.join(configuration.directory, "emails");
		await mkdir(emailsDir, { recursive: true });
		for (const email of value) {
			const filePath = path.join(emailsDir, `${email.slug || email.id}.md`);
			await writeFile(filePath, serialize(email));
		}
		return {
			updated: value.length,
			created: 0,
			deleted: 0,
			failed: 0,
		};
	},
	serialize: (emails) => emails.map((e) => serialize(e)),
	deserialize: (contents) => contents.map((s) => deserialize(s).email as Email),
};

export const EMAILS_RESOURCE: ResourceGroup<Email[], Email[], string[]> = {
	name: "emails",
	remote: REMOTE_EMAILS_RESOURCE,
	local: LOCAL_EMAILS_RESOURCE,
};
