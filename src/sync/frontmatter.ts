import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { errorMessage } from "./util.js";

/**
 * Renders fields plus body as a frontmatter markdown document. The YAML is
 * normalized to match Bun's YAML.stringify output (no trailing newline; a
 * space after keys that open nested blocks) so file contents don't churn
 * depending on which runtime wrote them.
 */
export function composeFrontmatterDocument(
	fields: Record<string, unknown>,
	body: string,
): string {
	let yamlContent = stringifyYAML(fields, { indent: 2 });
	yamlContent = yamlContent.endsWith("\n")
		? yamlContent.slice(0, -1)
		: yamlContent;
	yamlContent = yamlContent.replace(/^(\S+):(\n(?: {2}|\t))/gm, "$1: $2");
	return `---\n${yamlContent}\n---\n\n${body}`;
}

export type FrontmatterResult =
	| { ok: true; fields: Record<string, unknown>; body: string }
	| { ok: false; error: string };

// Anchored to line starts so `---` inside frontmatter values (e.g. a subject
// containing " --- ") or in the body never shifts the delimiter.
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Splits a markdown document into YAML frontmatter fields and body. Never
 * throws: malformed YAML, missing/empty frontmatter, and non-mapping
 * frontmatter (e.g. a plain document that happens to contain horizontal
 * rules) all return a descriptive error instead.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
	const match = FRONTMATTER_PATTERN.exec(content);
	if (!match) {
		return { ok: false, error: "Invalid format (missing frontmatter)" };
	}

	let parsed: unknown;
	try {
		parsed = parseYAML(match[1]);
	} catch (error) {
		return {
			ok: false,
			error: `Invalid frontmatter YAML: ${errorMessage(error)}`,
		};
	}

	if (
		parsed === null ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		Object.keys(parsed).length === 0
	) {
		return { ok: false, error: "Invalid format (empty frontmatter)" };
	}

	return {
		ok: true,
		fields: parsed as Record<string, unknown>,
		body: content.slice(match[0].length),
	};
}
