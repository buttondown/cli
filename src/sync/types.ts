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
