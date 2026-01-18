import type { Configuration, OperationResult } from "../sync/types.js";
import { constructClient, PAGE_SIZE } from "../sync/types.js";
import { paths } from "./openapi.js";

type PaginatedResponse<T> = {
	results?: T[];
	count?: number;
	next?: string | null;
	previous?: string | null;
};

type PathWithGet = "/emails" | "/automations";
type PathWithPatch = `${PathWithGet}/{id}`;
type PathWithPost = `${PathWithGet}`;

/**
 * Fetch all pages of a paginated API endpoint.
 * Handles the pagination loop and returns all results.
 */
export async function fetchAllPages<T>(
	configuration: Configuration,
	endpoint: PathWithGet,
): Promise<T[]> {
	const client = constructClient(configuration);
	const items: T[] = [];
	let page = 1;
	let hasMore = true;

	while (hasMore) {
		const response = await client.get(endpoint, {
			params: {
				query: {
					page,
					page_size: PAGE_SIZE,
				},
			},
		});

		const data = response.data as PaginatedResponse<T> | undefined;
		if (data?.results) {
			items.push(...data.results);
			hasMore = data.results.length === PAGE_SIZE;
		} else {
			hasMore = false;
		}
		page++;
	}

	return items;
}

export async function setRemotely<T extends { id: string }>(
	configuration: Configuration,
	baseEndpoint: PathWithGet,
	remoteItems: T[],
    localItems: T[],
    serialize: (item: T) => string,
): Promise<OperationResult> {
	const client = constructClient(configuration);
    const result: OperationResult = {
        updates: 0,
        creations: 0,
        noops: 0,
        deletions: 0,
    };
    for (const item of localItems) {
        const remoteItem = remoteItems.find((i) => i.id === item.id);
        if (remoteItem && serialize(remoteItem) !== serialize(item)) {
            result.updates++;
            await client.patch(`${baseEndpoint}/{id}`, {
                params: { path: { id: item.id } },
                body: item as any,
            });
        } else if (remoteItem) {
            result.noops++;
        } else {
            result.creations++;
            await client.post(baseEndpoint, {
                body: item as any,
            });
        }
    }
    // Find deletions.
    for (const remoteItem of remoteItems) {
        if (!localItems.some((i) => i.id === remoteItem.id)) {
            result.deletions++;
            await client.delete(`${baseEndpoint}/{id}`, {
                params: { path: { id: remoteItem.id } },
            });
        }
    }
    return result;
}