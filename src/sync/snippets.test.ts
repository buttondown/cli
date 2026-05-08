import { describe, expect, it } from "bun:test";
import {
  deserialize,
  LOCAL_SNIPPETS_RESOURCE,
  REMOTE_SNIPPETS_RESOURCE,
  serialize,
} from "./snippets.js";

const SAMPLE_SNIPPET = {
  id: "snp_abc123",
  identifier: "welcome-cta",
  name: "Welcome CTA",
  content: "Hi there! Click [here](https://example.com).",
};

describe("snippets", () => {
  describe("serialize", () => {
    it("should serialize snippet with frontmatter and body", () => {
      const result = serialize(SAMPLE_SNIPPET);

      expect(result).toContain("---");
      expect(result).toContain("id: snp_abc123");
      expect(result).toContain("name: Welcome CTA");
      expect(result).toContain("Hi there! Click [here](https://example.com).");
    });

    it("should not include the identifier in frontmatter (it's the filename)", () => {
      const result = serialize(SAMPLE_SNIPPET);
      expect(result).not.toContain("identifier:");
      expect(result).not.toContain("welcome-cta");
    });

    it("should not include content in frontmatter", () => {
      const result = serialize(SAMPLE_SNIPPET);
      const [, frontmatter] = result.split("---");
      expect(frontmatter).not.toContain("Hi there!");
    });

    it("should exclude null, undefined, and empty-string values", () => {
      const result = serialize({
        id: "",
        name: "Just a name",
        content: "body",
      });
      expect(result).not.toContain("id:");
      expect(result).toContain("name: Just a name");
    });
  });

  describe("deserialize", () => {
    it("should deserialize a serialized snippet", () => {
      const content = serialize(SAMPLE_SNIPPET);
      const result = deserialize(content);

      expect(result.isValid).toBe(true);
      expect(result.snippet.id).toBe("snp_abc123");
      expect(result.snippet.name).toBe("Welcome CTA");
      expect(result.snippet.content).toBe(
        "Hi there! Click [here](https://example.com).",
      );
    });

    it("should return invalid when frontmatter is missing", () => {
      const result = deserialize("just a body, no fences");

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("frontmatter");
    });

    it("should return invalid when frontmatter is empty", () => {
      const result = deserialize("---\n---\n\nbody");

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("frontmatter");
    });

    it("should preserve --- inside the body", () => {
      const content = "---\nname: Divider\n---\n\nbefore\n\n---\n\nafter";
      const result = deserialize(content);

      expect(result.isValid).toBe(true);
      expect(result.snippet.content).toContain("before");
      expect(result.snippet.content).toContain("after");
      expect(result.snippet.content).toContain("---");
    });
  });

  describe("serialize/deserialize roundtrip", () => {
    it("should preserve id, name, and content", () => {
      const serialized = serialize(SAMPLE_SNIPPET);
      const { snippet, isValid } = deserialize(serialized);

      expect(isValid).toBe(true);
      expect(snippet.id).toBe(SAMPLE_SNIPPET.id);
      expect(snippet.name).toBe(SAMPLE_SNIPPET.name);
      expect(snippet.content).toBe(SAMPLE_SNIPPET.content);
    });
  });

  describe("REMOTE_SNIPPETS_RESOURCE", () => {
    it("should have serialize as identity function", () => {
      const snippets = [SAMPLE_SNIPPET as any];
      expect(REMOTE_SNIPPETS_RESOURCE.serialize(snippets)).toEqual(snippets);
    });

    it("should have deserialize as identity function", () => {
      const snippets = [SAMPLE_SNIPPET as any];
      expect(REMOTE_SNIPPETS_RESOURCE.deserialize(snippets)).toEqual(snippets);
    });
  });

  describe("LOCAL_SNIPPETS_RESOURCE", () => {
    it("should serialize snippets to frontmatter strings", () => {
      const snippets = [SAMPLE_SNIPPET as any];
      const result = LOCAL_SNIPPETS_RESOURCE.serialize(snippets);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain("---");
      expect(result[0]).toContain("name: Welcome CTA");
    });

    it("should deserialize frontmatter strings to snippets", () => {
      const strings = [serialize(SAMPLE_SNIPPET)];
      const result = LOCAL_SNIPPETS_RESOURCE.deserialize(strings);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Welcome CTA");
      expect(result[0].id).toBe("snp_abc123");
    });
  });
});
