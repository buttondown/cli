import PACKAGE_JSON from "../../package.json" with { type: "json" };
import type { paths } from "../lib/openapi.js";
import { createClient } from "../lib/openapi-wrapper.js";

export type Configuration = {
	baseUrl: string;
	directory: string;
	username?: string;
	// Authentication: either apiKey OR accessToken must be provided
	apiKey?: string;
	accessToken?: string;
};

export type OperationResult = {
	updates: number;
	creations: number;
	noops: number;
	deletions: number;
};

export type Resource<Model, SerializedModel> = {
	get(configuration: Configuration): Promise<Model | null>;
	set(value: Model, configuration: Configuration): Promise<OperationResult>;
	serialize: (r: Model) => SerializedModel;
	deserialize: (s: SerializedModel) => Model;
};

export const constructClient = (configuration: Configuration) => {
	return createClient<paths>({
		base: `${configuration.baseUrl}/v1`,
		middlewares: [
			async (request, next) => {
				// Use Bearer token (OAuth) if available, otherwise fall back to API key
				if (configuration.accessToken) {
					request.headers.set(
						"authorization",
						`Bearer ${configuration.accessToken}`,
					);
				} else if (configuration.apiKey) {
					request.headers.set("authorization", `Token ${configuration.apiKey}`);
				}
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
