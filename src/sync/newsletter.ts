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
		return (
			response.data?.results.find(
				(n) => n.username === configuration.username,
			) || null
		);
	},
	async set(value, configuration): Promise<OperationResult> {
		await constructClient(configuration).patch("/newsletters/{id}", {
			params: { path: { id: value.id } },
			body: value,
		});
		return {
			updated: 1,
			created: 0,
			deleted: 0,
			failed: 0,
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
			updated: 1,
			created: 0,
			deleted: 0,
			failed: 0,
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
