import { describe, expect, it } from "bun:test";
import {
	deserialize,
	findRelativeImageReferences,
	serialize,
} from "./emails.js";

describe("emails", () => {
	describe("serialize", () => {
		it("should serialize email with basic fields", () => {
			const email = {
				id: "123",
				subject: "Test Subject",
				body: "Hello world",
				slug: "test-slug",
			};

			const result = serialize(email);

			expect(result).toContain("---");
			expect(result).toContain('id: "123"');
			expect(result).toContain("subject: Test Subject");
			expect(result).toContain("slug: test-slug");
			expect(result).toContain("Hello world");
		});

		it("should exclude default values from frontmatter", () => {
			const email = {
				id: "123",
				subject: "Test",
				body: "Content",
				email_type: "public" as const,
				featured: false,
				commenting_mode: "enabled" as const,
			};

			const result = serialize(email);

			expect(result).not.toContain("email_type");
			expect(result).not.toContain("featured");
			expect(result).not.toContain("commenting_mode");
		});

		it("should include non-default values", () => {
			const email = {
				id: "123",
				subject: "Test",
				body: "Content",
				email_type: "private" as const,
				featured: true,
			};

			const result = serialize(email);

			expect(result).toContain("email_type: private");
			expect(result).toContain("featured: true");
		});

		it("should exclude empty values", () => {
			const email = {
				id: "123",
				subject: "Test",
				body: "Content",
				description: "",
				metadata: {},
			};

			const result = serialize(email);

			expect(result).not.toContain("description");
			expect(result).not.toContain("metadata");
		});

		it("should strip markdown mode sigil from body", () => {
			const email = {
				id: "123",
				subject: "Test",
				body: "<!-- buttondown-editor-mode: plaintext -->Hello world",
			};

			const result = serialize(email);

			expect(result).not.toContain("buttondown-editor-mode");
			expect(result).toContain("Hello world");
		});
	});

	describe("deserialize", () => {
		it("should deserialize valid markdown with frontmatter", () => {
			const content = `---
id: "123"
subject: Test Subject
slug: test-slug
---

Hello world`;

			const result = deserialize(content);

			expect(result.isValid).toBe(true);
			expect(result.email.id).toBe("123");
			expect(result.email.subject).toBe("Test Subject");
			expect(result.email.slug).toBe("test-slug");
			expect(result.email.body).toBe("Hello world");
		});

		it("should return invalid for content without frontmatter", () => {
			const content = "Just plain content without frontmatter";

			const result = deserialize(content);

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("missing frontmatter");
		});

		it("should parse array attachments", () => {
			const content = `---
id: "123"
subject: Test
attachments:
  - file1.pdf
  - file2.pdf
---

Content`;

			const result = deserialize(content);

			expect(result.isValid).toBe(true);
			expect(result.email.attachments).toEqual(["file1.pdf", "file2.pdf"]);
		});

		it("should handle metadata field", () => {
			const content = `---
id: "123"
subject: Test
metadata:
  key1: value1
  key2: value2
---

Content`;

			const result = deserialize(content);

			expect(result.isValid).toBe(true);
			expect(result.email.metadata).toEqual({ key1: "value1", key2: "value2" });
		});
	});

	describe("serialize/deserialize roundtrip", () => {
		it("should preserve data through roundtrip", () => {
			const original = {
				id: "123",
				subject: "Test Subject",
				body: "Hello world",
				slug: "test-slug",
				status: "draft" as const,
				description: "A test email",
			};

			const serialized = serialize(original);
			const { email } = deserialize(serialized);

			expect(email.id).toBe(original.id);
			expect(email.subject).toBe(original.subject);
			expect(email.body).toBe(original.body);
			expect(email.slug).toBe(original.slug);
			expect(email.status).toBe(original.status);
			expect(email.description).toBe(original.description);
		});
	});

	describe("findRelativeImageReferences", () => {
		it("should find relative image references", () => {
			const content =
				"Here is an image: ![alt text](../images/test.png) and another ![](./local.jpg)";

			const result = findRelativeImageReferences(content);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				match: "![alt text](../images/test.png)",
				altText: "alt text",
				relativePath: "../images/test.png",
			});
			expect(result[1]).toEqual({
				match: "![](./local.jpg)",
				altText: "",
				relativePath: "./local.jpg",
			});
		});

		it("should ignore absolute URLs", () => {
			const content =
				"Absolute: ![test](https://example.com/image.png) and ![test](//cdn.example.com/img.jpg)";

			const result = findRelativeImageReferences(content);

			expect(result).toHaveLength(0);
		});

		it("should handle mixed relative and absolute references", () => {
			const content = `
        Relative: ![local](../test.png)
        Absolute: ![remote](https://example.com/remote.jpg)
        Another relative: ![another](./subfolder/image.gif)
      `;

			const result = findRelativeImageReferences(content);

			expect(result).toHaveLength(2);
			expect(result[0].relativePath).toBe("../test.png");
			expect(result[1].relativePath).toBe("./subfolder/image.gif");
		});
	});
});
