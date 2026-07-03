import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { components } from "../lib/openapi.js";
import {
	constructClient,
	type OperationResult,
	omit,
	type Resource,
	type ResourceGroup,
	throwIfError,
} from "./types.js";
import { stableStringify } from "./util.js";

type Newsletter = components["schemas"]["Newsletter"];

/**
 * Order-independent, secret-free representation for change detection: the
 * api_key is stripped from local files, so it must not participate in the
 * local-vs-remote comparison either.
 */
export function canonicalizeForDiff(newsletter: Newsletter): string {
	return stableStringify(omit(newsletter, ["api_key"]));
}

export const REMOTE_NEWSLETTER_RESOURCE: Resource<Newsletter, Newsletter> = {
	async get(configuration) {
		const response = await constructClient(configuration).get("/newsletters");
		throwIfError(response, "Failed to fetch newsletter");
		const results = response.data?.results ?? [];
		// An API key is scoped to a single newsletter, so the list has exactly
		// one relevant entry; the username filter only applies when configured.
		if (configuration.username) {
			return results.find((n) => n.username === configuration.username) ?? null;
		}
		return results[0] ?? null;
	},
	async set(value, configuration): Promise<OperationResult> {
		const result = await constructClient(configuration).patch(
			"/newsletters/{id}",
			{
				params: { path: { id: value.id } },
				body: omit(value, [
					"api_key",
					"creation_date",
					"id",
					"sharing_networks",
					"sort",
				]),
			},
		);
		throwIfError(result, `Failed to update newsletter ${value.id}`);
		return {
			updated: 1,
			created: 0,
			deleted: 0,
			failed: 0,
			errors: [],
		};
	},
	serialize: (d) => d,
	deserialize: (d) => d,
};

export const LOCAL_NEWSLETTER_RESOURCE: Resource<Newsletter, Newsletter> = {
	async get(configuration) {
		const filePath = path.join(configuration.directory, "newsletter.json");
		let content: string;
		try {
			content = await readFile(filePath, "utf8");
		} catch (error: any) {
			if (error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
		try {
			return JSON.parse(content);
		} catch {
			throw new Error(
				`${filePath} is not valid JSON; fix or delete it before syncing.`,
			);
		}
	},
	async set(value, configuration): Promise<OperationResult> {
		const filePath = path.join(configuration.directory, "newsletter.json");
		// Never persist the API key into the (likely git-tracked) sync directory.
		await writeFile(
			filePath,
			JSON.stringify(omit(value, ["api_key"]), null, 2),
		);
		return {
			updated: 1,
			created: 0,
			deleted: 0,
			failed: 0,
			errors: [],
		};
	},
	serialize: (r) => r,
	deserialize: (s) => s,
};

export const NEWSLETTER_RESOURCE: ResourceGroup<
	Newsletter,
	Newsletter,
	Newsletter
> = {
	name: "newsletter",
	remote: REMOTE_NEWSLETTER_RESOURCE,
	local: LOCAL_NEWSLETTER_RESOURCE,
};
