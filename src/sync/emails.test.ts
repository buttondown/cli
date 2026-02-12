import { describe, expect, it } from "bun:test";
import {
	convertAbsoluteToRelativeImages,
	deserialize,
	findRelativeImageReferences,
	replaceImageReference,
	resolveRelativeImageReferences,
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

		it("should return consistent results when called multiple times", () => {
			const content = "![alt](./image.png) and ![alt2](../photo.jpg)";

			const result1 = findRelativeImageReferences(content);
			const result2 = findRelativeImageReferences(content);
			const result3 = findRelativeImageReferences(content);

			expect(result1).toHaveLength(2);
			expect(result2).toHaveLength(2);
			expect(result3).toHaveLength(2);
			expect(result1).toEqual(result2);
			expect(result2).toEqual(result3);
		});
	});

	describe("replaceImageReference", () => {
		it("should replace a relative image reference with an absolute URL", () => {
			const content = "Here is ![alt](../media/image.png) in my email";
			const result = replaceImageReference(
				content,
				"![alt](../media/image.png)",
				"https://assets.buttondown.email/images/abc123.png",
				"alt",
			);
			expect(result).toBe(
				"Here is ![alt](https://assets.buttondown.email/images/abc123.png) in my email",
			);
		});

		it("should only replace the exact match", () => {
			const content = "![a](./one.png) and ![b](./two.png) and ![a](./one.png)";
			const result = replaceImageReference(
				content,
				"![a](./one.png)",
				"https://example.com/one.png",
				"a",
			);
			expect(result).toBe(
				"![a](https://example.com/one.png) and ![b](./two.png) and ![a](./one.png)",
			);
		});
	});

	describe("resolveRelativeImageReferences", () => {
		it("should resolve relative paths to absolute URLs using the image map", () => {
			const content = "Check out ![photo](../media/photo.png) in this email";
			const emailDir = "/project/buttondown/emails";
			const syncedImages: Record<string, { localPath: string; url: string }> = {
				img1: {
					localPath: "/project/buttondown/media/photo.png",
					url: "https://assets.buttondown.email/images/photo.png",
				},
			};

			const result = resolveRelativeImageReferences(
				content,
				emailDir,
				syncedImages,
			);

			expect(result).toBe(
				"Check out ![photo](https://assets.buttondown.email/images/photo.png) in this email",
			);
		});

		it("should leave references intact when no matching synced image exists", () => {
			const content = "![photo](../media/unknown.png)";
			const emailDir = "/project/buttondown/emails";
			const syncedImages: Record<string, { localPath: string; url: string }> =
				{};

			const result = resolveRelativeImageReferences(
				content,
				emailDir,
				syncedImages,
			);

			expect(result).toBe("![photo](../media/unknown.png)");
		});

		it("should resolve multiple relative references", () => {
			const content = "![a](../media/one.png) text ![b](../media/two.jpg)";
			const emailDir = "/project/buttondown/emails";
			const syncedImages: Record<string, { localPath: string; url: string }> = {
				img1: {
					localPath: "/project/buttondown/media/one.png",
					url: "https://example.com/one.png",
				},
				img2: {
					localPath: "/project/buttondown/media/two.jpg",
					url: "https://example.com/two.jpg",
				},
			};

			const result = resolveRelativeImageReferences(
				content,
				emailDir,
				syncedImages,
			);

			expect(result).toBe(
				"![a](https://example.com/one.png) text ![b](https://example.com/two.jpg)",
			);
		});
	});

	describe("convertAbsoluteToRelativeImages", () => {
		it("should convert absolute URLs to relative paths for synced images", () => {
			const content =
				"![photo](https://assets.buttondown.email/images/photo.png)";
			const emailDir = "/project/buttondown/emails";
			const syncedImages: Record<string, { localPath: string; url: string }> = {
				img1: {
					localPath: "/project/buttondown/media/photo.png",
					url: "https://assets.buttondown.email/images/photo.png",
				},
			};

			const result = convertAbsoluteToRelativeImages(
				content,
				emailDir,
				syncedImages,
			);

			expect(result).toBe("![photo](../media/photo.png)");
		});

		it("should leave non-synced absolute URLs intact", () => {
			const content = "![photo](https://other-cdn.com/photo.png)";
			const emailDir = "/project/buttondown/emails";
			const syncedImages: Record<string, { localPath: string; url: string }> =
				{};

			const result = convertAbsoluteToRelativeImages(
				content,
				emailDir,
				syncedImages,
			);

			expect(result).toBe("![photo](https://other-cdn.com/photo.png)");
		});

		it("should convert multiple absolute URLs", () => {
			const content =
				"![a](https://example.com/one.png) and ![b](https://example.com/two.jpg)";
			const emailDir = "/project/buttondown/emails";
			const syncedImages: Record<string, { localPath: string; url: string }> = {
				img1: {
					localPath: "/project/buttondown/media/one.png",
					url: "https://example.com/one.png",
				},
				img2: {
					localPath: "/project/buttondown/media/two.jpg",
					url: "https://example.com/two.jpg",
				},
			};

			const result = convertAbsoluteToRelativeImages(
				content,
				emailDir,
				syncedImages,
			);

			expect(result).toBe("![a](../media/one.png) and ![b](../media/two.jpg)");
		});
	});
});
