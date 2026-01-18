import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { components } from "../lib/openapi.js";
import {
	constructClient,
	type OperationResult,
	type Resource,
	type ResourceGroup,
} from "./types.js";

type Newsletter = components["schemas"]["Newsletter"];

export const REMOTE_NEWSLETTER_RESOURCE: Resource<Newsletter, Newsletter> = {
	async get(configuration) {
		const response = await constructClient(configuration).get("/newsletters");
		const newsletters = response.data?.results || [];

		// If username specified, find matching newsletter
		if (configuration.username) {
			return (
				newsletters.find((n) => n.username === configuration.username) || null
			);
		}

		// Otherwise return the first newsletter (most users have only one)
		return newsletters[0] || null;
	},
	async set(value, configuration): Promise<OperationResult> {
		await constructClient(configuration).patch("/newsletters/{id}", {
			params: { path: { id: value.id } },
			body: value,
		});
		return {
			updates: 1,
			creations: 0,
			noops: 0,
			deletions: 0,
		};
	},
	serialize: (d) => d,
	deserialize: (d) => d,
};

export const LOCAL_NEWSLETTER_RESOURCE: Resource<Newsletter, Newsletter> = {
	async get(configuration) {
		const filePath = path.join(configuration.directory, "newsletter.json");
		return JSON.parse(await readFile(filePath, "utf8"));
	},
	async set(value, configuration): Promise<OperationResult> {
		const filePath = path.join(configuration.directory, "newsletter.json");
		await writeFile(filePath, JSON.stringify(value, null, 2));
		return {
			updates: 1,
			creations: 0,
			noops: 0,
			deletions: 0,
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
