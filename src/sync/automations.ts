import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { components } from "../lib/openapi.js";
import {
	constructClient,
	type OperationResult,
	PAGE_SIZE,
	type Resource,
	type ResourceGroup,
} from "./types.js";

type Automation = components["schemas"]["Automation"];

type SerializedAutomation = Pick<
	Automation,
	| "id"
	| "name"
	| "status"
	| "trigger"
	| "timing"
	| "actions"
	| "filters"
	| "metadata"
	| "should_evaluate_filter_after_delay"
>;

const SERIALIZED_FIELDS: (keyof SerializedAutomation)[] = [
	"actions",
	"filters",
	"id",
	"metadata",
	"name",
	"should_evaluate_filter_after_delay",
	"status",
	"timing",
	"trigger",
];

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function serialize(automation: Partial<Automation>): string {
	const obj: Record<string, unknown> = {};
	for (const field of SERIALIZED_FIELDS) {
		if (
			automation[field] !== null &&
			automation[field] !== undefined
		) {
			obj[field] = automation[field];
		}
	}
	return JSON.stringify(obj, null, 2);
}

export function deserialize(content: string): {
	automation: Partial<Automation>;
	isValid: boolean;
	error?: string;
} {
	try {
		const parsed = JSON.parse(content) as Record<string, unknown>;
		const automation: Partial<Automation> = {};
		for (const field of SERIALIZED_FIELDS) {
			if (parsed[field] !== undefined) {
				(automation as Record<string, unknown>)[field] = parsed[field];
			}
		}
		if (!automation.name) {
			return {
				automation,
				isValid: false,
				error: "Missing required field: name",
			};
		}
		return { automation, isValid: true };
	} catch {
		return {
			automation: {},
			isValid: false,
			error: "Invalid JSON",
		};
	}
}

export const REMOTE_AUTOMATIONS_RESOURCE: Resource<
	Automation[],
	Automation[]
> = {
	async get(configuration) {
		const automations: Automation[] = [];
		let page = 1;
		let hasMore = true;

		while (hasMore) {
			const response = await constructClient(configuration).get(
				"/automations",
				{
					params: {
						query: {
							page,
							page_size: PAGE_SIZE,
						},
					},
				},
			);

			if (response.data?.results) {
				automations.push(...response.data.results);
				hasMore = response.data.results.length === PAGE_SIZE;
			} else {
				hasMore = false;
			}
			page++;
		}

		return automations;
	},
	async set(value, configuration): Promise<OperationResult> {
		let updated = 0;
		let created = 0;
		const deleted = 0;
		const failed = 0;
		for (const automation of value) {
			if (automation.id) {
				await constructClient(configuration).patch(
					"/automations/{id}",
					{
						params: { path: { id: automation.id } },
						body: automation,
					},
				);
				updated++;
			} else {
				await constructClient(configuration).post("/automations", {
					body: {
						name: automation.name || "",
						trigger: automation.trigger,
						timing: automation.timing,
						actions: automation.actions,
						filters: automation.filters,
						metadata: automation.metadata as Record<string, string>,
						should_evaluate_filter_after_delay:
							automation.should_evaluate_filter_after_delay,
					},
				});
				created++;
			}
		}
		return {
			updated,
			created,
			deleted,
			failed,
		};
	},
	serialize: (d) => d,
	deserialize: (d) => d,
};

export const LOCAL_AUTOMATIONS_RESOURCE: Resource<
	Automation[],
	string[]
> = {
	async get(configuration) {
		const automationsDir = path.join(
			configuration.directory,
			"automations",
		);
		const automationFiles = await fg("**/*.json", {
			cwd: automationsDir,
			absolute: false,
		});

		const automations: Automation[] = [];
		for (const automationFile of automationFiles) {
			const content = await readFile(
				path.join(automationsDir, automationFile),
				"utf8",
			);
			const result = deserialize(content);
			if (result.isValid) {
				automations.push(result.automation as Automation);
			}
		}

		return automations;
	},
	async set(value, configuration) {
		const automationsDir = path.join(
			configuration.directory,
			"automations",
		);
		await mkdir(automationsDir, { recursive: true });
		for (const automation of value) {
			const filePath = path.join(
				automationsDir,
				`${slugify(automation.name)}.json`,
			);
			await writeFile(filePath, serialize(automation));
		}
		return {
			updated: value.length,
			created: 0,
			deleted: 0,
			failed: 0,
		};
	},
	serialize: (automations) => automations.map((a) => serialize(a)),
	deserialize: (contents) =>
		contents.map((c) => deserialize(c).automation as Automation),
};

export const AUTOMATIONS_RESOURCE: ResourceGroup<
	Automation[],
	Automation[],
	string[]
> = {
	name: "automations",
	remote: REMOTE_AUTOMATIONS_RESOURCE,
	local: LOCAL_AUTOMATIONS_RESOURCE,
};
