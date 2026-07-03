import PACKAGE_JSON from "../../package.json" with { type: "json" };
import type { paths } from "../lib/openapi.js";
import { createClient } from "../lib/openapi-core.js";
import { errorMessage } from "./util.js";

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
	errors: string[];
};

export const emptyResult = (): OperationResult => ({
	updated: 0,
	created: 0,
	deleted: 0,
	failed: 0,
	errors: [],
});

export type SetHooks = {
	/** Called after a successful create with the server-assigned id. */
	onCreated?: (item: unknown, id: string) => Promise<void>;
};

export type Resource<Model, SerializedModel> = {
	get(configuration: Configuration): Promise<Model | null>;
	set(
		value: Model,
		configuration: Configuration,
		hooks?: SetHooks,
	): Promise<OperationResult>;
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
 * Drops read-only response fields before sending an object back as a
 * request body. The API's update schemas don't accept them, and the typed
 * client rejects unexpected body fields at compile time.
 */
export function omit<T extends object, K extends keyof T>(
	obj: T,
	keys: readonly K[],
): Omit<T, K> {
	return Object.fromEntries(
		Object.entries(obj).filter(([key]) => !keys.includes(key as K)),
	) as Omit<T, K>;
}

/**
 * The typed client returns `{ error }` on a non-2xx response instead of
 * throwing, so both read and write paths must opt in to surfacing failures.
 * Throws a descriptive error including the serialized API response (e.g. the
 * 422 validation details) when the call did not succeed.
 */
export function throwIfError<T extends { error?: unknown }>(
	result: T,
	context: string,
): asserts result is T & { error?: undefined } {
	if (result.error === undefined) return;
	const detail =
		typeof result.error === "string"
			? result.error
			: JSON.stringify(result.error);
	throw new Error(`${context}: ${detail}`);
}

/**
 * Walks a paginated endpoint and returns every result. `fetchPage` should
 * return the full typed-client result so HTTP errors (401s, 500s, rate
 * limits) fail the sync loudly instead of masquerading as an empty or
 * truncated list.
 */
export async function paginatedList<T>(
	context: string,
	fetchPage: (
		page: number,
		pageSize: number,
	) => Promise<{ data?: { results?: T[] }; error?: unknown }>,
): Promise<T[]> {
	const items: T[] = [];
	let page = 1;
	let hasMore = true;
	while (hasMore) {
		const response = await fetchPage(page, PAGE_SIZE);
		throwIfError(response, context);
		const results = response.data?.results;
		if (results?.length) {
			items.push(...results);
			hasMore = results.length === PAGE_SIZE;
		} else {
			hasMore = false;
		}
		page++;
	}
	return items;
}

/**
 * Walks a list of items, calling `update` for each item with an id and
 * `create` for each item without one. A failing item is counted and
 * reported rather than aborting the remaining operations, so one deleted
 * remote resource or validation error can't wedge the whole push.
 */
export async function bulkSet<T extends { id?: string | undefined }>(
	items: T[],
	spec: {
		update: (item: T & { id: string }) => Promise<void>;
		/** Returns the server-assigned id of the created resource, if any. */
		create: (item: T) => Promise<string | undefined>;
		label?: (item: T) => string;
	},
	hooks?: SetHooks,
): Promise<OperationResult> {
	const result = emptyResult();
	for (const item of items) {
		const label = spec.label?.(item) ?? item.id ?? "(new)";
		try {
			if (item.id) {
				await spec.update(item as T & { id: string });
				result.updated++;
			} else {
				const id = await spec.create(item);
				result.created++;
				if (id && hooks?.onCreated) {
					await hooks.onCreated(item, id);
				}
			}
		} catch (error) {
			result.failed++;
			result.errors.push(`${label}: ${errorMessage(error)}`);
		}
	}
	return result;
}
