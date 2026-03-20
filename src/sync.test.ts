import { describe, expect, it } from "bun:test";
import { deserialize } from "./sync/emails.js";

// All sync tests have been moved to individual module test files:
// - sync/automations.test.ts
// - sync/emails.test.ts
// - sync/images.test.ts
// - sync/newsletter.test.ts

describe("sync", () => {
  it("should export resources", async () => {
    const { RESOURCES } = await import("./sync/index.js");
    expect(RESOURCES).toHaveLength(5);
  });

  describe("frontmatter slug handling", () => {
    it("parses quoted slug values without keeping quotes", () => {
      const doubleQuoted = deserialize(`---
slug: "4"
---

Body`);
      const singleQuoted = deserialize(`---
slug: 'issue-4'
---

Body`);

      expect(doubleQuoted.isValid).toBe(true);
      expect(doubleQuoted.email.slug).toBe("4");
      expect(singleQuoted.isValid).toBe(true);
      expect(singleQuoted.email.slug).toBe("issue-4");
    });
  });
});
