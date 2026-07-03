import path from "node:path";
import fs from "fs-extra";
import { composeFrontmatterDocument } from "../sync/frontmatter.js";

/**
 * Creates a new local draft email and returns where it landed. Frontmatter
 * is generated with a YAML serializer so titles containing ":", "#", quotes
 * or newlines can't produce a file the CLI later fails to parse.
 */
export async function createDraft(
	directory: string,
	title: string,
): Promise<{ filePath: string; slug: string }> {
	const emailsDir = path.join(directory, "emails");
	await fs.ensureDir(emailsDir);

	const slug = title
		.toLowerCase()
		.replaceAll(/[^a-z\d]+/g, "-")
		.replaceAll(/(^-|-$)/g, "");

	if (!slug) {
		throw new Error("Title must contain at least one alphanumeric character");
	}

	const filePath = path.join(emailsDir, `${slug}.md`);

	if (await fs.pathExists(filePath)) {
		throw new Error(`Email with slug "${slug}" already exists at ${filePath}`);
	}

	const content = composeFrontmatterDocument(
		{
			subject: title,
			status: "draft",
			slug,
			editor_mode: "plaintext",
		},
		"Write your email content here...\n",
	);

	await fs.writeFile(filePath, content);

	return { filePath, slug };
}
