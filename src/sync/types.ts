import PACKAGE_JSON from "../../package.json" with { type: "json" };
import type { paths } from "../lib/openapi.js";
import { createClient } from "../lib/openapi-wrapper.js";

export type Configuration = {
  baseUrl: string;
  apiKey: string;
  username?: string;
  directory: string;
};

export type OperationResult = {
  updated: number;
  created: number;
  deleted: number;
  failed: number;
};

export type Resource<Model, SerializedModel> = {
  get(configuration: Configuration): Promise<Model | null>;
  set(value: Model, configuration: Configuration): Promise<OperationResult>;
  serialize: (r: Model) => SerializedModel;
  deserialize: (s: SerializedModel) => Model;
};

export const constructClient = (configuration: Configuration) => {
  return createClient<paths>({
    base: configuration.baseUrl,
    middlewares: [
      async (request, next) => {
        request.headers.set("authorization", `Token ${configuration.apiKey}`);
        request.headers.set(
          "user-agent",
          `buttondown-cli/${PACKAGE_JSON.version}`,
        );
        return next(request);
      },
    ],
  });
};

export type ResourceGroup<A, B, C> = {
  remote: Resource<A, B>;
  local: Resource<B, C>;
  name: string;
};

export const PAGE_SIZE = 100;

/**
 * Walks a paginated endpoint and returns every result.
 * `fetchPage` should return the page payload (typically `response.data`)
 * or null/undefined to terminate.
 */
export async function paginatedList<T>(
  fetchPage: (
    page: number,
    pageSize: number,
  ) => Promise<{ results?: T[] } | null | undefined>,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const response = await fetchPage(page, PAGE_SIZE);
    if (response?.results) {
      items.push(...response.results);
      hasMore = response.results.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
    page++;
  }
  return items;
}

/**
 * Walks a list of items, calling `update` for each item with an id and
 * `create` for each item without one. Counts the operations and returns
 * an OperationResult.
 */
export async function bulkSet<T extends { id?: string | undefined }>(
  items: T[],
  spec: {
    update: (item: T & { id: string }) => Promise<void>;
    create: (item: T) => Promise<void>;
  },
): Promise<OperationResult> {
  let updated = 0;
  let created = 0;
  for (const item of items) {
    if (item.id) {
      await spec.update(item as T & { id: string });
      updated++;
    } else {
      await spec.create(item);
      created++;
    }
  }
  return { updated, created, deleted: 0, failed: 0 };
}
