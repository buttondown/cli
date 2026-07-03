import type { components } from "../lib/openapi.js";
import {
	type LocalFileEntry,
	pathsById,
	readLocalFiles,
	type SkippedFile,
	writeLocalFiles,
} from "./local-files.js";
import {
	bulkSet,
	type Configuration,
	constructClient,
	omit,
	paginatedList,
	type Resource,
	type ResourceGroup,
	type SetHooks,
	throwIfError,
} from "./types.js";
import { stableStringify } from "./util.js";

type Automation = components["schemas"]["Automation"];

type SerializedAutomation = Pick<
	Automation,
	| "id"
	| "name"
	| "status"
	| "trigger"
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
		if (automation[field] !== null && automation[field] !== undefined) {
			obj[field] = automation[field];
		}
	}
	return JSON.stringify(obj, null, 2);
}

/**
 * Order-independent representation for change detection; nested objects
 * (triggers, actions, filters) compare by value regardless of the key order
 * of the local JSON file vs. the API response.
 */
export function canonicalizeForDiff(automation: Partial<Automation>): string {
	const obj: Record<string, unknown> = {};
	for (const field of SERIALIZED_FIELDS) {
		if (automation[field] !== null && automation[field] !== undefined) {
			obj[field] = automation[field];
		}
	}
	return stableStringify(obj);
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

export const REMOTE_AUTOMATIONS_RESOURCE: Resource<Automation[], Automation[]> =
	{
		get: (configuration) =>
			paginatedList<Automation>(
				"Failed to fetch automations",
				(page, pageSize) =>
					constructClient(configuration).get("/automations", {
						params: { query: { page, page_size: pageSize } },
					}),
			),
		set: (value, configuration, hooks?: SetHooks) =>
			bulkSet(
				value,
				{
					label: (automation) => automation.name || "(automation)",
					update: async (automation) => {
						const result = await constructClient(configuration).patch(
							"/automations/{id}",
							{
								params: { path: { id: automation.id } },
								body: omit(automation, ["creation_date", "id"]),
							},
						);
						throwIfError(
							result,
							`Failed to update automation ${automation.id}`,
						);
					},
					create: async (automation) => {
						const result = await constructClient(configuration).post(
							"/automations",
							{
								body: {
									name: automation.name || "",
									trigger: automation.trigger,
									actions: automation.actions,
									filters: automation.filters,
									metadata: automation.metadata as Record<string, string>,
									should_evaluate_filter_after_delay:
										automation.should_evaluate_filter_after_delay,
								},
							},
						);
						throwIfError(
							result,
							`Failed to create automation "${automation.name ?? ""}"`,
						);
						return result.data?.id;
					},
				},
				hooks,
			),
		serialize: (d) => d,
		deserialize: (d) => d,
	};

export type LocalAutomationEntry = LocalFileEntry<Partial<Automation>>;

export function readLocalAutomations(configuration: Configuration): Promise<{
	entries: LocalAutomationEntry[];
	skipped: SkippedFile[];
}> {
	return readLocalFiles<Partial<Automation>>({
		directory: configuration.directory,
		name: "automations",
		pattern: "**/*.json",
		parse: (content) => {
			const result = deserialize(content);
			return result.isValid
				? { value: result.automation }
				: { error: result.error ?? "Invalid automation file" };
		},
	});
}

export const LOCAL_AUTOMATIONS_RESOURCE: Resource<Automation[], string[]> = {
	async get(configuration) {
		const { entries } = await readLocalAutomations(configuration);
		return entries.map((entry) => entry.value as Automation);
	},
	async set(value, configuration) {
		const { entries } = await readLocalAutomations(configuration);
		return writeLocalFiles({
			directory: configuration.directory,
			name: "automations",
			extension: ".json",
			items: value,
			idOf: (automation) => automation.id,
			stemOf: (automation) => slugify(automation.name),
			serialize,
			existingPathById: pathsById(entries, (automation) => automation.id),
		});
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
