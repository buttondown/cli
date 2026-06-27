import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import type { components } from "../lib/openapi.js";
import {
  bulkSet,
  constructClient,
  omit,
  paginatedList,
  type Resource,
  type ResourceGroup,
  throwIfError,
} from "./types.js";

type Snippet = components["schemas"]["Snippet"];

type FrontMatterFields = Pick<Snippet, "id" | "name">;

const FRONT_MATTER_FIELDS: (keyof FrontMatterFields)[] = ["id", "name"];

export function deserialize(content: string): {
  snippet: Partial<Snippet>;
  isValid: boolean;
  error?: string;
} {
  const parts = content.split("---");
  if (parts.length < 3) {
    return {
      snippet: { content },
      isValid: false,
      error: "Invalid format (missing frontmatter)",
    };
  }

  const [_, frontmatter, ...bodyParts] = parts;

  const parsedYAML = (parseYAML(frontmatter) ?? {}) as Record<string, any>;
  if (Object.keys(parsedYAML).length === 0) {
    return {
      snippet: { content },
      isValid: false,
      error: "Invalid format (missing frontmatter)",
    };
  }

  const snippet: Partial<Snippet> = {
    content: bodyParts.join("---").trim(),
  };

  for (const field of FRONT_MATTER_FIELDS) {
    if (parsedYAML[field]) snippet[field] = parsedYAML[field];
  }

  return { snippet, isValid: true };
}

export function serialize(snippet: Partial<Snippet>): string {
  const { content, ...rest } = snippet;

  const restObject = Object.fromEntries(
    Object.entries(rest).filter(
      ([field, value]) =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        FRONT_MATTER_FIELDS.includes(field as keyof FrontMatterFields),
    ) as [keyof FrontMatterFields, any][],
  );
  let yamlContent = stringifyYAML(restObject, { indent: 2 });
  yamlContent = yamlContent.endsWith("\n")
    ? yamlContent.slice(0, -1)
    : yamlContent;
  yamlContent = yamlContent.replace(/^(\S+):(\n(?: {2}|\t))/gm, "$1: $2");
  return `---\n${yamlContent}\n---\n\n${content}`;
}

export const REMOTE_SNIPPETS_RESOURCE: Resource<Snippet[], Snippet[]> = {
  get: (configuration) =>
    paginatedList<Snippet>(async (page, pageSize) => {
      const response = await constructClient(configuration).get("/snippets", {
        params: { query: { page, page_size: pageSize } },
      });
      return response.data;
    }),
  set: (value, configuration) =>
    bulkSet(value, {
      update: async (snippet) => {
        const result = await constructClient(configuration).patch(
          "/snippets/{id}",
          {
            params: { path: { id: snippet.id } },
            body: omit(snippet, ["creation_date", "id", "reference_count"]),
          },
        );
        throwIfError(result, `Failed to update snippet ${snippet.id}`);
      },
      create: async (snippet) => {
        const result = await constructClient(configuration).post("/snippets", {
          body: {
            identifier: snippet.identifier || "",
            name: snippet.name || "",
            content: snippet.content || "",
          },
        });
        throwIfError(
          result,
          `Failed to create snippet "${snippet.identifier ?? ""}"`,
        );
      },
    }),
  serialize: (d) => d,
  deserialize: (d) => d,
};

export const LOCAL_SNIPPETS_RESOURCE: Resource<Snippet[], string[]> = {
  async get(configuration) {
    const snippetsDir = path.join(configuration.directory, "snippets");
    const snippetFiles = await fg("**/*.md", {
      cwd: snippetsDir,
      absolute: false,
    });

    const snippets: Snippet[] = [];
    for (const snippetFile of snippetFiles) {
      const content = await readFile(
        path.join(snippetsDir, snippetFile),
        "utf8",
      );
      const result = deserialize(content);
      if (result.isValid) {
        const identifier = path.basename(snippetFile, ".md");
        snippets.push({ identifier, ...result.snippet } as Snippet);
      }
    }

    return snippets;
  },
  async set(value, configuration) {
    const snippetsDir = path.join(configuration.directory, "snippets");
    await mkdir(snippetsDir, { recursive: true });
    for (const snippet of value) {
      const filePath = path.join(snippetsDir, `${snippet.identifier}.md`);
      await writeFile(filePath, serialize(snippet));
    }
    return {
      updated: value.length,
      created: 0,
      deleted: 0,
      failed: 0,
    };
  },
  serialize: (snippets) => snippets.map((s) => serialize(s)),
  deserialize: (contents) =>
    contents.map((s) => deserialize(s).snippet as Snippet),
};

export const SNIPPETS_RESOURCE: ResourceGroup<Snippet[], Snippet[], string[]> =
  {
    name: "snippets",
    remote: REMOTE_SNIPPETS_RESOURCE,
    local: LOCAL_SNIPPETS_RESOURCE,
  };
