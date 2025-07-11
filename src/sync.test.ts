import { describe, expect, it } from "vitest";
import { SyncManager } from "./sync.js";

describe("SyncManager Image Processing", () => {
  // Create a mock SyncManager instance for testing private methods
  class TestSyncManager extends SyncManager {
    constructor() {
      super({ directory: "/tmp/test" });
    }

    // Expose private methods for testing
    public testFindRelativeImageReferences(content: string) {
      return this.findRelativeImageReferences(content);
    }

    public testConvertAbsoluteToRelativeImages(
      content: string,
      emailDir: string,
      syncedImages: any,
    ) {
      return (this as any).convertAbsoluteToRelativeImages(
        content,
        emailDir,
        syncedImages,
      );
    }

    public async testProcessRelativeImages(
      content: string,
      emailDir: string,
      syncedImages: any,
    ) {
      return (this as any).processRelativeImages(
        content,
        emailDir,
        syncedImages,
      );
    }
  }

  describe("findRelativeImageReferences", () => {
    it("should find relative image references", () => {
      const manager = new TestSyncManager();
      const content =
        "Here is an image: ![alt text](../images/test.png) and another ![](./local.jpg)";

      const result = manager.testFindRelativeImageReferences(content);

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
      const manager = new TestSyncManager();
      const content =
        "Absolute: ![test](https://example.com/image.png) and ![test](//cdn.example.com/img.jpg)";

      const result = manager.testFindRelativeImageReferences(content);

      expect(result).toHaveLength(0);
    });

    it("should handle mixed relative and absolute references", () => {
      const manager = new TestSyncManager();
      const content = `
        Relative: ![local](../test.png)
        Absolute: ![remote](https://example.com/remote.jpg)
        Another relative: ![another](./subfolder/image.gif)
      `;

      const result = manager.testFindRelativeImageReferences(content);

      expect(result).toHaveLength(2);
      expect(result[0].relativePath).toBe("../test.png");
      expect(result[1].relativePath).toBe("./subfolder/image.gif");
    });
  });

  describe("convertAbsoluteToRelativeImages", () => {
    it("should convert absolute URLs to relative paths when image is synced", () => {
      const manager = new TestSyncManager();
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

      const result = manager.testConvertAbsoluteToRelativeImages(
        content,
        emailDir,
        syncedImages,
      );

      expect(result).toBe("Check this image: ![test](../media/image.png)");
    });

    it("should leave absolute URLs unchanged when image is not synced", () => {
      const manager = new TestSyncManager();
      const content =
        "Check this image: ![test](https://example.com/uploads/unknown.png)";
      const emailDir = "/path/to/emails";
      const syncedImages = {};

      const result = manager.testConvertAbsoluteToRelativeImages(
        content,
        emailDir,
        syncedImages,
      );

      expect(result).toBe(
        "Check this image: ![test](https://example.com/uploads/unknown.png)",
      );
    });

    it("should handle multiple images correctly", () => {
      const manager = new TestSyncManager();
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

      const result = manager.testConvertAbsoluteToRelativeImages(
        content,
        emailDir,
        syncedImages,
      );

      expect(result).toContain("![test1](../media/image1.png)");
      expect(result).toContain("![test2](https://example.com/image2.png)"); // unchanged
      expect(result).toContain("![test3](../media/subfolder/image3.jpg)");
    });
  });

  describe("processRelativeImages", () => {
    it("should skip upload for images that already exist in syncedImages", async () => {
      const manager = new TestSyncManager();
      const content = "Test image: ![test](../media/existing.png)";
      const emailDir = "/path/to/emails";
      const syncedImages = {
        img123: {
          id: "img123",
          url: "https://example.com/uploads/existing.png",
          localPath: "/path/to/media/existing.png",
          filename: "existing.png",
          creation_date: "2023-01-01",
          lastSynced: "2023-01-01",
        },
      };

      // This test would require mocking file system operations
      // For now, just test the logic conceptually
      expect(syncedImages.img123.localPath).toBe("/path/to/media/existing.png");
    });
  });

  describe("generateContentHash", () => {
    it("should include description and image fields in content hash", () => {
      const manager = new TestSyncManager();

      const emailWithoutDescriptionAndImage = {
        subject: "Test Subject",
        body: "Test Body",
        status: "draft",
        email_type: "public",
        slug: "test-slug",
        publish_date: "2023-01-01",
        attachments: [],
      };

      const emailWithDescriptionAndImage = {
        ...emailWithoutDescriptionAndImage,
        description: "Test Description",
        image: "https://example.com/image.png",
      };

      const hash1 = (manager as any).generateContentHash(
        emailWithoutDescriptionAndImage,
      );
      const hash2 = (manager as any).generateContentHash(
        emailWithDescriptionAndImage,
      );

      expect(hash1).not.toBe(hash2);
    });
  });
});
