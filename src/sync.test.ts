import { describe, expect, it } from "bun:test";
import type { components } from "./lib/openapi.js";
import { findRelativeImageReferences } from "./lib/serde/email.js";
import { hash } from "./lib/utils.js";
import { convertAbsoluteToRelativeImages } from "./sync.js";

type Email = components["schemas"]["Email"];

describe("sync", () => {
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

  describe("convertAbsoluteToRelativeImages", () => {
    it("should convert absolute URLs to relative paths when image is synced", () => {
      const content =
        "Check this image: ![test](https://example.com/uploads/image.png)";
      const emailDir = "/path/to/emails";
      const syncedImages = {
        img123: {
          id: "img123",
          url: "https://example.com/uploads/image.png",
          localPath: "/path/to/media/image.png",
          filename: "image.png",
          creation_date: "2023-01-01",
          lastSynced: "2023-01-01",
        },
      };

      const result = convertAbsoluteToRelativeImages(
        content,
        emailDir,
        syncedImages,
      );

      expect(result).toBe("Check this image: ![test](../media/image.png)");
    });

    it("should leave absolute URLs unchanged when image is not synced", () => {
      const content =
        "Check this image: ![test](https://example.com/uploads/unknown.png)";
      const emailDir = "/path/to/emails";
      const syncedImages = {};

      const result = convertAbsoluteToRelativeImages(
        content,
        emailDir,
        syncedImages,
      );

      expect(result).toBe(
        "Check this image: ![test](https://example.com/uploads/unknown.png)",
      );
    });

    it("should handle multiple images correctly", () => {
      const content = `
        Known image: ![test1](https://example.com/image1.png)
        Unknown image: ![test2](https://example.com/image2.png)
        Another known: ![test3](https://example.com/image3.jpg)
      `;
      const emailDir = "/path/to/emails";
      const syncedImages = {
        img1: {
          id: "img1",
          url: "https://example.com/image1.png",
          localPath: "/path/to/media/image1.png",
          filename: "image1.png",
          creation_date: "2023-01-01",
          lastSynced: "2023-01-01",
        },
        img3: {
          id: "img3",
          url: "https://example.com/image3.jpg",
          localPath: "/path/to/media/subfolder/image3.jpg",
          filename: "image3.jpg",
          creation_date: "2023-01-01",
          lastSynced: "2023-01-01",
        },
      };

      const result = convertAbsoluteToRelativeImages(
        content,
        emailDir,
        syncedImages,
      );

      expect(result).toContain("![test1](../media/image1.png)");
      expect(result).toContain("![test2](https://example.com/image2.png)"); // unchanged
      expect(result).toContain("![test3](../media/subfolder/image3.jpg)");
    });
  });

  describe("generateContentHash", () => {
    it("should include description and image fields in content hash", () => {
      const emailWithoutDescriptionAndImage = {
        subject: "Test Subject",
        body: "Test Body",
        status: "draft",
        email_type: "public",
        slug: "test-slug",
        publish_date: "2023-01-01",
        attachments: [],
      } as Partial<Email>;

      const emailWithDescriptionAndImage = {
        ...emailWithoutDescriptionAndImage,
        description: "Test Description",
        image: "https://example.com/image.png",
      } as Partial<Email>;

      const hash1 = hash([
        emailWithoutDescriptionAndImage.body || "",
        emailWithoutDescriptionAndImage.status || "",
        emailWithoutDescriptionAndImage.email_type || "",
        emailWithoutDescriptionAndImage.slug || "",
        emailWithoutDescriptionAndImage.publish_date || "",
        emailWithoutDescriptionAndImage.description || "",
        emailWithoutDescriptionAndImage.image || "",
        JSON.stringify(emailWithoutDescriptionAndImage.attachments || []),
      ]);
      const hash2 = hash([
        emailWithDescriptionAndImage.body || "",
        emailWithDescriptionAndImage.status || "",
        emailWithDescriptionAndImage.email_type || "",
        emailWithDescriptionAndImage.slug || "",
        emailWithDescriptionAndImage.publish_date || "",
        emailWithDescriptionAndImage.description || "",
        emailWithDescriptionAndImage.image || "",
        JSON.stringify(emailWithDescriptionAndImage.attachments || []),
      ]);

      expect(hash1).not.toBe(hash2);
    });
  });
});
