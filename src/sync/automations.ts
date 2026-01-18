import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { fetchAllPages } from "../lib/api.js";
import type { components } from "../lib/openapi.js";
import {
	constructClient,
	type OperationResult,
	type Resource,
	type ResourceGroup,
} from "./types.js";

type Automation = components["schemas"]["Automation"];

const AUTOMATIONS_FILENAME = "automations.yaml";

/**
 * Serialize automations array into YAML content
 */
export function serialize(automations: Automation[]): string {
	return stringifyYAML(automations, { indent: 2 });
}

/**
 * Deserialize YAML content into automations array
 */
export function deserialize(content: string): {
	automations: Automation[];
	isValid: boolean;
	error?: string;
} {
	try {
		const automations = parseYAML(content) as Automation[];
		if (!Array.isArray(automations)) {
			return {
				automations: [],
				isValid: false,
				error: "Invalid YAML format: expected array",
			};
		}
		return { automations, isValid: true };
	} catch (error) {
		return {
			automations: [],
			isValid: false,
			error: error instanceof Error ? error.message : "Failed to parse YAML",
		};
	}
}

export const REMOTE_AUTOMATIONS_RESOURCE: Resource<Automation[], Automation[]> =
	{
		async get(configuration) {
			return fetchAllPages<Automation>(configuration, "/automations");
		},
		async set(value, configuration): Promise<OperationResult> {
			const allAutomations = await this.get(configuration);
			if (!allAutomations) {
				return {
					updates: 0,
					creations: 0,
					noops: 0,
					deletions: 0,
				};
			}

			const data = {
				updates: [] as Automation[],
				creations: [] as Automation[],
				deletions: [] as Automation[],
				noops: [] as Automation[],
			};

			for (const automation of value) {
				if (automation.id) {
					const existingAutomation = allAutomations.find(
						(a) => a.id === automation.id,
					);
					if (existingAutomation) {
						// Compare by serializing both to check for changes
						if (
							JSON.stringify(existingAutomation) !== JSON.stringify(automation)
						) {
							data.updates.push(automation);
						} else {
							data.noops.push(automation);
						}
					} else {
						// Local automation has an ID that doesn't exist on server
						// This could mean it was deleted remotely - skip but warn
						console.warn(
							`Warning: Automation "${automation.name}" has ID ${automation.id} but does not exist on server. Skipping.`,
						);
						data.noops.push(automation);
					}
				} else {
					data.creations.push(automation);
				}
			}

			const client = constructClient(configuration);
			for (const automation of data.updates) {
				await client.patch("/automations/{id}", {
					params: { path: { id: automation.id } },
					body: {
						name: automation.name,
						status: automation.status,
						trigger: automation.trigger,
						actions: automation.actions,
					},
				});
			}
			for (const automation of data.creations) {
				await client.post("/automations", {
					body: {
						name: automation.name,
						trigger: automation.trigger,
						timing: automation.timing,
						actions: automation.actions,
						filters: automation.filters,
					},
				});
			}
			return {
				updates: data.updates.length,
				creations: data.creations.length,
				noops: data.noops.length,
				deletions: data.deletions.length,
			};
		},
		serialize: (d) => d,
		deserialize: (d) => d,
	};

export const LOCAL_AUTOMATIONS_RESOURCE: Resource<Automation[], Automation[]> =
	{
		async get(configuration) {
			const filePath = path.join(configuration.directory, AUTOMATIONS_FILENAME);
			if (!existsSync(filePath)) {
				return [];
			}

			const content = await readFile(filePath, "utf8");
			const result = deserialize(content);
			if (result.isValid) {
				return result.automations;
			}
			return [];
		},
		async set(value, configuration) {
			const filePath = path.join(configuration.directory, AUTOMATIONS_FILENAME);

			const serialized = serialize(value);

			if (!existsSync(filePath)) {
				await writeFile(filePath, serialized);
				return {
					updates: 0,
					creations: value.length,
					noops: 0,
					deletions: 0,
				};
			}

			const existing = await readFile(filePath, "utf8");
			if (serialized !== existing) {
				await writeFile(filePath, serialized);
				return {
					updates: value.length,
					creations: 0,
					noops: 0,
					deletions: 0,
				};
			}

			return {
				updates: 0,
				creations: 0,
				noops: value.length,
				deletions: 0,
			};
		},
		serialize: (automations) => automations,
		deserialize: (automations) => automations,
	};

export const AUTOMATIONS_RESOURCE: ResourceGroup<
	Automation[],
	Automation[],
	Automation[]
> = {
	name: "automations",
	remote: REMOTE_AUTOMATIONS_RESOURCE,
	local: LOCAL_AUTOMATIONS_RESOURCE,
};
