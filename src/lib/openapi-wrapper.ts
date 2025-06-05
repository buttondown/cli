// #region Utility types
type RequiredKeysOf<TType extends Record<string, unknown>> = TType extends any
	? Exclude<
			{
				[Key in keyof TType]: TType extends Record<Key, TType[Key]>
					? Key
					: never;
			}[keyof TType],
			undefined
		>
	: never;

type HasRequiredKeys<TType extends Record<string, unknown>> =
	RequiredKeysOf<TType> extends never ? false : true;

type Dig<TObject, TPattern> = TObject[keyof TObject & TPattern];

type GetValueWithDefault<TObject, TPattern, TDefault> = TObject extends any
	? Dig<TObject, TPattern> extends never
		? TDefault
		: Dig<TObject, TPattern>
	: never;

// #endregion

// #region Middleware runner
type Middleware<TParameters extends any[], TReturn> = (
	...parameters: [...TParameters, next: (...parameters: TParameters) => TReturn]
) => TReturn;

const createAsyncMiddlewareRunner = <TParameters extends any[], TReturn>(
	middlewares: [
		...Array<Middleware<TParameters, Promise<TReturn>>>,
		Middleware<TParameters, Promise<TReturn>>,
	],
) =>
	// prettier-ignore
	middlewares.reduceRight<(...parameters: TParameters) => Promise<TReturn>>(
		(next, run) =>
			async (...args) =>
				run(...args, next),
		async () => {
			throw new Error("middleware chain exhausted");
		},
	);
export type FetchMiddleware = Middleware<[request: Request], Promise<Response>>;
// #endregion

// #region Request
export type HttpMethod =
	| "get"
	| "put"
	| "post"
	| "delete"
	| "options"
	| "head"
	| "patch"
	| "trace";

type BodyType<T = unknown> = {
	json: T;
	text: string;
	blob: Blob;
	bytes: Uint8Array;
	stream: ReadableStream<Uint8Array>;
};

export type ParseAs = keyof BodyType;

export type ParamsOptions<T> = T extends { parameters: any }
	? HasRequiredKeys<Dig<T["parameters"], string>> extends true
		? { params: T["parameters"] }
		: { params?: T["parameters"] }
	: {
			params?: {
				query?: Record<string, unknown>;
				path?: Record<string, unknown>;
			};
		};

export type BodyOptions<T> = T extends { requestBody: { content: infer C } }
	? C extends { "application/json": infer B extends Record<string, unknown> }
		? { body: B }
		: C extends { "multipart/form-data": Record<string, unknown> }
			? { body: FormData }
			: {}
	: { body?: BodyInit };

export type RequestOptions<T> = ParamsOptions<T> &
	BodyOptions<T> & { parseAs?: ParseAs };

export type FetchOptions<T> = Omit<RequestInit, "method" | "body"> &
	RequestOptions<T>;
// #endregion

// #region Response
// prettier-ignore
type OkStatus = 200 | 201 | 202 | 203 | 204 | 206 | 207 | "2XX";
// prettier-ignore
type ErrorStatus =
	| 500
	| 501
	| 502
	| 503
	| 504
	| 505
	| 506
	| 507
	| 508
	| 510
	| 511
	| "5XX"
	| 400
	| 401
	| 402
	| 403
	| 404
	| 405
	| 406
	| 407
	| 408
	| 409
	| 410
	| 411
	| 412
	| 413
	| 414
	| 415
	| 416
	| 417
	| 418
	| 420
	| 421
	| 422
	| 423
	| 424
	| 425
	| 426
	| 429
	| 431
	| 444
	| 450
	| 451
	| 497
	| 498
	| 499
	| "4XX"
	| "default";

type MediaType = `${string}/${string}`;

type ResponseContent<T> = T extends { content: any } ? T["content"] : unknown;
type ResponseObjectMap<T> = T extends { responses: any }
	? T["responses"]
	: unknown;

export type ParseAsResponse<T, O> = O extends { parseAs: ParseAs }
	? BodyType<T>[O["parseAs"]]
	: T;

type SuccessResponse<T> = ResponseContent<Dig<T, OkStatus>>;
type ErrorResponse<T> = ResponseContent<Dig<T, ErrorStatus>>;

export type FetchResponse<TSchema, TInit> =
	| {
			response: Response;
			data: ParseAsResponse<
				GetValueWithDefault<
					SuccessResponse<ResponseObjectMap<TSchema>>,
					MediaType,
					Record<string, never>
				>,
				TInit
			>;
			error?: never;
	  }
	| {
			response: Response;
			error: ParseAsResponse<
				GetValueWithDefault<
					ErrorResponse<ResponseObjectMap<TSchema>>,
					MediaType,
					Record<string, never>
				>,
				TInit
			>;
			data?: never;
	  };
// #endregion

// #region OpenAPI paths
export type PathsWithMethod<TPath, TMethod extends HttpMethod> = {
	[Pathname in keyof TPath]: TPath[Pathname] extends Record<TMethod, unknown>
		? Pathname
		: never;
}[keyof TPath];

type PathMethods = Partial<Record<HttpMethod, {}>>;
type Paths = Record<string, PathMethods>;
// #endregion

// #region Client
type ClientMethod<TPaths extends Paths, TMethod extends HttpMethod> = <
	TPath extends PathsWithMethod<TPaths, TMethod>,
	TInit extends FetchOptions<TPaths[TPath][TMethod]>,
>(
	path: TPath,
	...rest: HasRequiredKeys<TInit> extends true ? [init: TInit] : [init?: TInit]
) => Promise<FetchResponse<TPaths[TPath][TMethod], TInit>>;

export type Client<TPaths extends {}> = {
	get: ClientMethod<TPaths, "get">;
	put: ClientMethod<TPaths, "put">;
	post: ClientMethod<TPaths, "post">;
	delete: ClientMethod<TPaths, "delete">;
	options: ClientMethod<TPaths, "options">;
	head: ClientMethod<TPaths, "head">;
	patch: ClientMethod<TPaths, "patch">;
	trace: ClientMethod<TPaths, "trace">;
};

export type ClientOptions = {
	base?: string;
	middlewares?: FetchMiddleware[];
	fetch?: typeof fetch;
};

const isBodyInit = (body: any): boolean =>
	body instanceof Blob ||
	body instanceof ReadableStream ||
	body instanceof URLSearchParams ||
	body instanceof FormData ||
	body instanceof ArrayBuffer ||
	ArrayBuffer.isView(body);

export const createClient = <TPaths extends {}>({
	base: baseUrl = "",
	middlewares = [],
	fetch: fetchThis,
}: ClientOptions = {}): Client<TPaths> => {
	// If we had set `fetch` above, `createClient` would've grabbed a copy of
	// fetch before we're able to mock it in tests
	const run = createAsyncMiddlewareRunner<[request: Request], Response>([
		...middlewares,
		async (request) => (fetchThis ?? fetch)(request),
	]);

	const createHttpMethod =
		(method: HttpMethod) =>
		async (
			path: string,
			{
				body,
				params,
				headers,
				parseAs = "json",
				...init
			}: FetchOptions<{}> = {},
		) => {
			headers = new Headers(headers);

			if (!headers.has("accept")) {
				headers.set("accept", "application/json");
			}

			if (typeof body === "object" && !isBodyInit(body)) {
				body = JSON.stringify(body);

				if (!headers.has("content-type")) {
					headers.set("content-type", "application/json");
				}
			}

			const url =
				baseUrl +
				serializePathParameters(path, params?.path) +
				serializeQueryParams(params?.query);

			const request = new Request(url, {
				...init,
				method: method.toUpperCase(),
				body,
				headers,
			});
			const response = await run(request);

			const isOkResponse = response.ok;
			const isEmptyResponse =
				response.status === 204 ||
				response.headers.get("content-length") === "0";

			if (isEmptyResponse) {
				return isOkResponse ? { response, data: {} } : { response, error: {} };
			}

			if (response.ok) {
				// If "stream", skip parsing entirely
				if (parseAs === "stream") {
					return { response, data: response.body };
				}

				return { response, data: await response[parseAs]() };
			}

			let error = await response.text();
			try {
				error = JSON.parse(error);
			} catch {
				// Noop
			}

			return { response, error };
		};

	return {
		get: createHttpMethod("get"),
		put: createHttpMethod("put"),
		post: createHttpMethod("post"),
		delete: createHttpMethod("delete"),
		options: createHttpMethod("options"),
		head: createHttpMethod("head"),
		patch: createHttpMethod("patch"),
		trace: createHttpMethod("trace"),
	} as any;
};
// #endregion

// #region Request serializers
const serializePathParameters = (
	path: string,
	parameters: Record<string, unknown> = {},
): string =>
	path.replaceAll(/{([^}]+)}/g, (_match, key) => "" + parameters[key]);

export const serializeQueryParams = (
	parameters: Record<string, unknown> = {},
): string => {
	let searchParameters: URLSearchParams | undefined;

	for (const key in parameters) {
		const value = parameters[key];

		if (value === undefined) {
			continue;
		}

		// Lazily initialize search params
		searchParameters ??= new URLSearchParams();

		if (Array.isArray(value)) {
			for (let idx = 0, { length } = value; idx < length; idx++) {
				const value_ = value[idx];
				searchParameters.append(key, "" + value_);
			}
		} else {
			searchParameters.set(key, "" + value);
		}
	}

	return searchParameters ? `?${searchParameters.toString()}` : "";
};
// #endregion

type Promisable<T> = T | Promise<T>;

type OkResponse<T> =
	| { response: Response; data: T | undefined; error?: never }
	| { response: Response; error: { detail: string }; data?: never };

export function ok<T>(value: Promise<OkResponse<T>>): Promise<T>;
export function ok<T>(value: OkResponse<T>): T;
export function ok(value: Promisable<OkResponse<any>>): any {
	if (value instanceof Promise) {
		return value.then(ok);
	}

	if (value.error) {
		throw new OkapiError(value.response, value.error, value.error.detail);
	}

	return value.data;
}

// Would've named it ApiError if openapi-typescript-fetch wasn't around,
// so naming it after the forest giraffe for now.
// https://en.wikipedia.org/wiki/Okapi
export class OkapiError extends Error {
	constructor(
		public response: Response,
		public data: unknown,
		message: string,
	) {
		super(message);
	}
}
