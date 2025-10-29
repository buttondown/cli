import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import type { components } from "../openapi.js";
import { hash as genericHash } from "../utils.js";

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
  const [_, frontmatter, body] = content.split("---");

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
  yamlContent = yamlContent.replace(/^(\S+):(\n(?:  |\t))/gm, "$1: $2");
  return "---\n" + yamlContent + "\n---\n\n" + cleanedBody;
}

const RELATIVE_IMAGE_REFERENCE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function hash(email: Partial<Email & FrontMatterFields>): string {
  return genericHash([
    email.body || "",
    email.status || "",
    email.email_type || "",
    email.slug || "",
    email.publish_date || "",
    email.description || "",
    email.image || "",
    JSON.stringify(email.attachments || []),
  ]);
}

/**
 * Find relative image references in markdown content
 */
export function findRelativeImageReferences(
  content: string,
): RelativeImageReference[] {
  const regex = RELATIVE_IMAGE_REFERENCE_REGEX;
  const results: RelativeImageReference[] = [];
  let match;

  // biome-ignore lint/suspicious/noAssignInExpressions: necessary for regex.exec() pattern
  while ((match = regex.exec(content)) !== null) {
    const [fullMatch, altText, imagePath] = match;

    if (!imagePath.startsWith("http") && !imagePath.startsWith("//")) {
      results.push({
        match: fullMatch,
        altText,
        relativePath: imagePath,
      });
    }
  }

  return results;
}

/**
 * Replace image references in content
 */
export function replaceImageReference(
  content: string,
  originalReference: string,
  newUrl: string,
  altText: string,
): string {
  const newReference = `![${altText}](${newUrl})`;
  return content.replace(originalReference, newReference);
}
