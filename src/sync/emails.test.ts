import { describe, expect, it } from "bun:test";
import {
	canonicalizeForDiff,
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

		it("should lift the plaintext sigil out of the body into editor_mode", () => {
			const email = {
				id: "123",
				subject: "Test",
				body: "<!-- buttondown-editor-mode: plaintext -->Hello world",
			};

			const result = serialize(email);

			expect(result).toContain("editor_mode: plaintext");
			const body = result.split("---\n\n")[1];
			expect(body).not.toContain("buttondown-editor-mode");
			expect(body).toContain("Hello world");
		});

		it("should lift the fancy sigil out of the body into editor_mode", () => {
			const result = serialize({
				id: "123",
				subject: "Test",
				body: "<!-- buttondown-editor-mode: fancy -->Hello world",
			});

			expect(result).toContain("editor_mode: fancy");
			const body = result.split("---\n\n")[1];
			expect(body).not.toContain("buttondown-editor-mode");
		});

		it("should produce YAML-safe frontmatter for hostile subjects", () => {
			const result = serialize({
				id: "123",
				subject: 'Rollout: phase "2" #launch',
				body: "Content",
			});

			const { email, isValid } = deserialize(result);
			expect(isValid).toBe(true);
			expect(email.subject).toBe('Rollout: phase "2" #launch');
		});

		it("should not emit a literal 'undefined' body", () => {
			const result = serialize({ id: "123", subject: "Test" });
			expect(result).not.toContain("undefined");
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

		it("should return invalid for plain markdown containing horizontal rules", () => {
			const content = "Intro\n---\nMiddle\n---\nEnd";

			const result = deserialize(content);

			expect(result.isValid).toBe(false);
		});

		it("should return invalid instead of throwing on malformed YAML", () => {
			const content = "---\nsubject: Rollout: phase 2\n---\n\nBody";

			const result = deserialize(content);

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("Invalid frontmatter YAML");
		});

		it("should return invalid instead of throwing on empty frontmatter", () => {
			const result = deserialize("---\n\n---\n\nBody");

			expect(result.isValid).toBe(false);
			expect(result.error).toContain("empty frontmatter");
		});

		it("should preserve explicit falsy values", () => {
			const content = `---
id: "123"
featured: false
---

Content`;

			const result = deserialize(content);

			expect(result.isValid).toBe(true);
			expect(result.email.featured).toBe(false);
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

		it("should preserve horizontal rules in body content", () => {
			const content = `---
id: "123"
subject: Test
---

First section

---

Second section

---

Third section`;

			const result = deserialize(content);

			expect(result.isValid).toBe(true);
			expect(result.email.body).toBe(
				"First section\n\n---\n\nSecond section\n\n---\n\nThird section",
			);
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

		it("should preserve subjects containing frontmatter delimiters", () => {
			const original = {
				id: "123",
				subject: "Week 3 --- recap",
				slug: "week-3",
				body: "Hello",
			};

			const serialized = serialize(original);
			const { email, isValid } = deserialize(serialized);

			expect(isValid).toBe(true);
			expect(email.subject).toBe("Week 3 --- recap");
			expect(email.slug).toBe("week-3");
			expect(email.body).toBe("Hello");
		});

		it("should preserve horizontal rules through roundtrip", () => {
			const original = {
				id: "123",
				subject: "Test",
				body: "First section\n\n---\n\nSecond section",
			};

			const serialized = serialize(original);
			const { email } = deserialize(serialized);

			expect(email.body).toBe(original.body);
		});

		it("should preserve the fancy editor mode through roundtrip", () => {
			const serialized = serialize({
				id: "123",
				subject: "Test",
				body: "<!-- buttondown-editor-mode: fancy -->Hello world",
			});
			const { email } = deserialize(serialized);

			expect(email.editor_mode).toBe("fancy");
			expect(email.body).toBe("Hello world");
		});

		it("should preserve the plaintext editor mode through roundtrip", () => {
			const serialized = serialize({
				id: "123",
				subject: "Test",
				body: "<!-- buttondown-editor-mode: plaintext -->Hello world",
			});
			const { email } = deserialize(serialized);

			expect(email.editor_mode).toBe("plaintext");
			expect(email.body).toBe("Hello world");
		});

		it("should produce stable output after multiple roundtrips", () => {
			const original = {
				id: "123",
				subject: "Test",
				body: "<!-- buttondown-editor-mode: fancy -->Hello world",
			};

			const serialized1 = serialize(original);
			const { email: email1 } = deserialize(serialized1);
			const serialized2 = serialize(email1);
			const { email: email2 } = deserialize(serialized2);

			expect(serialized2).toBe(serialized1);
			expect(email2).toEqual(email1);
		});
	});

	describe("canonicalizeForDiff", () => {
		it("should be insensitive to object key order", () => {
			const local = { id: "123", subject: "Test", body: "Hello world" };
			const remote = { subject: "Test", body: "Hello world", id: "123" };

			expect(canonicalizeForDiff(local)).toBe(canonicalizeForDiff(remote));
		});

		it("should be insensitive to nested key order (metadata, filters)", () => {
			const local = {
				id: "123",
				subject: "T",
				body: "b",
				metadata: { a: "1", b: "2" },
			};
			const remote = {
				id: "123",
				subject: "T",
				body: "b",
				metadata: { b: "2", a: "1" },
			};

			expect(canonicalizeForDiff(local)).toBe(canonicalizeForDiff(remote));
		});

		it("should treat omitted fields as their documented defaults", () => {
			const local = { id: "123", subject: "T", body: "b" };
			const remote = {
				id: "123",
				subject: "T",
				body: "b",
				featured: false,
				email_type: "public" as const,
				commenting_mode: "enabled" as const,
				related_email_ids: [],
			};

			expect(canonicalizeForDiff(local)).toBe(canonicalizeForDiff(remote));
		});

		it("should be insensitive to trailing whitespace in bodies", () => {
			const local = { id: "123", subject: "T", body: "Hello" };
			const remote = { id: "123", subject: "T", body: "Hello\n" };

			expect(canonicalizeForDiff(local)).toBe(canonicalizeForDiff(remote));
		});

		it("should detect explicit falsy overrides of truthy remote values", () => {
			const local = { id: "123", subject: "T", body: "b", featured: false };
			const remote = { id: "123", subject: "T", body: "b", featured: true };

			expect(canonicalizeForDiff(local)).not.toBe(canonicalizeForDiff(remote));
		});

		it("should treat a local editor_mode field as equal to a remote body sigil", () => {
			const local = {
				id: "123",
				subject: "T",
				body: "Hello",
				editor_mode: "fancy",
			};
			const remote = {
				id: "123",
				subject: "T",
				body: "<!-- buttondown-editor-mode: fancy -->Hello",
			};

			expect(canonicalizeForDiff(local)).toBe(canonicalizeForDiff(remote));
		});

		it("should detect editor mode changes", () => {
			const local = {
				id: "123",
				subject: "T",
				body: "Hello",
				editor_mode: "plaintext",
			};
			const remote = {
				id: "123",
				subject: "T",
				body: "<!-- buttondown-editor-mode: fancy -->Hello",
			};

			expect(canonicalizeForDiff(local)).not.toBe(canonicalizeForDiff(remote));
		});

		it("should produce different output when body differs", () => {
			const local = { id: "123", subject: "Test", body: "Updated body" };
			const remote = { id: "123", subject: "Test", body: "Hello world" };

			expect(canonicalizeForDiff(local)).not.toBe(canonicalizeForDiff(remote));
		});

		it("should produce different output when frontmatter fields differ", () => {
			const local = { id: "123", subject: "New Subject", body: "Hello" };
			const remote = { id: "123", subject: "Old Subject", body: "Hello" };

			expect(canonicalizeForDiff(local)).not.toBe(canonicalizeForDiff(remote));
		});

		it("should ignore extra remote fields not in frontmatter", () => {
			const local = { id: "123", subject: "Test", body: "Hello world" };
			const remote = {
				id: "123",
				subject: "Test",
				body: "Hello world",
				creation_date: "2025-01-01",
				modification_date: "2025-01-02",
			};

			expect(canonicalizeForDiff(local)).toBe(canonicalizeForDiff(remote));
		});
	});

	describe("findRelativeImageReferences", () => {
		it("should find relative image references", () => {
			const content =
				"Here is an image: ![alt text](../images/test.png) and another ![](./local.jpg)";

			const result = findRelativeImageReferences(content);

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				match: "![alt text](../images/test.png)",
				altText: "alt text",
				relativePath: "../images/test.png",
			});
			expect(result[1]).toMatchObject({
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

		it("should ignore data URIs, mailto links, absolute paths, and anchors", () => {
			const content = [
				"![d](data:image/png;base64,AAAA)",
				"![m](mailto:x@example.com)",
				"![a](/etc/hostname)",
				"![h](#section)",
			].join(" ");

			const result = findRelativeImageReferences(content);

			expect(result).toHaveLength(0);
		});

		it("should exclude markdown titles from the captured path", () => {
			const result = findRelativeImageReferences(
				"![alt](image.png \"A title\") and ![alt2](other.png 'single')",
			);

			expect(result).toHaveLength(2);
			expect(result[0].relativePath).toBe("image.png");
			expect(result[1].relativePath).toBe("other.png");
		});

		it("should handle angle-bracketed paths with spaces", () => {
			const result = findRelativeImageReferences("![alt](<my image.png>)");

			expect(result).toHaveLength(1);
			expect(result[0].relativePath).toBe("my image.png");
		});

		it("should ignore references inside fenced code blocks", () => {
			const content =
				"![real](a.png)\n```\n![example](docs.png)\n```\n![also-real](b.png)";

			const result = findRelativeImageReferences(content);

			expect(result.map((r) => r.relativePath)).toEqual(["a.png", "b.png"]);
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

		it("should not interpret replacement patterns in URLs or alt text", () => {
			const content = "A ![x $' y](./a.png) TAIL";
			const result = replaceImageReference(
				content,
				"![x $' y](./a.png)",
				"https://example.com/$&.png",
				"x $' y",
			);
			expect(result).toBe("A ![x $' y](https://example.com/$&.png) TAIL");
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

		it("should resolve duplicate references to the same image", () => {
			const content = "![a](./one.png) then again ![a](./one.png)";
			const syncedImages = {
				img1: { localPath: "/d/one.png", url: "https://example.com/one.png" },
			};

			const result = resolveRelativeImageReferences(
				content,
				"/d",
				syncedImages,
			);

			expect(result).toBe(
				"![a](https://example.com/one.png) then again ![a](https://example.com/one.png)",
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
