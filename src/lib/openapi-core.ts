// Canonical typed OpenAPI client core, shared by every TypeScript consumer
// of the Buttondown API. Source of truth: app/assets/lib/openapi-core.ts.
// The copy at cli/src/lib/openapi-core.ts is written by `//app:generate-files`
// (and verified by CI's generated-files check) — never edit the copy directly.

// #region Utility types
type RequiredKeysOf<TType extends object> = TType extends any
  ? Exclude<
      {
        [Key in keyof TType]: TType extends Record<Key, TType[Key]>
          ? Key
          : never;
      }[keyof TType],
      undefined
    >
  : never;

type HasRequiredKeys<TType extends object> = RequiredKeysOf<TType> extends never
  ? false
  : true;

type Dig<TObject, TPattern> = TObject[keyof TObject & TPattern];

type GetValueWithDefault<TObject, TPattern, TDefault> = TObject extends any
  ? Dig<TObject, TPattern> extends never
    ? TDefault
    : Dig<TObject, TPattern>
  : never;

// #endregion

// #region Middleware runner
type Middleware<TParams extends any[], TReturn> = (
  ...params: [...TParams, next: (...params: TParams) => TReturn]
) => TReturn;

const createAsyncMiddlewareRunner = <TParams extends any[], TReturn>(
  middlewares: [
    ...Middleware<TParams, Promise<TReturn>>[],
    Middleware<TParams, Promise<TReturn>>
  ]
) => {
  // prettier-ignore
  return middlewares.reduceRight<(...params: TParams) => Promise<TReturn>>(
		(next, run) => (...args) => run(...args, next),
		() => Promise.reject(new Error(`middleware chain exhausted`)),
	);
};

type FetchMiddleware = Middleware<[request: Request], Promise<Response>>;
// #endregion

// #region Request
type HttpMethod =
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

type ParseAs = keyof BodyType;

type ParamsOptions<T> = T extends { parameters: any }
  ? HasRequiredKeys<Dig<T["parameters"], string>> extends true
    ? { params: T["parameters"] }
    : { params?: T["parameters"] }
  : {
      params?: {
        query?: Record<string, unknown>;
        path?: Record<string, unknown>;
      };
    };

type BodyOptions<T> = T extends { requestBody: { content: infer C } }
  ? C extends { "application/json": infer B extends Record<string, unknown> }
    ? { body: B }
    : C extends { "multipart/form-data": Record<string, unknown> }
    ? { body: FormData }
    : {}
  : { body?: BodyInit };

type RequestOptions<T> = ParamsOptions<T> &
  BodyOptions<T> & { parseAs?: ParseAs };

type FetchOptions<T> = Omit<RequestInit, "method" | "body"> & RequestOptions<T>;
// #endregion

// #region Response
// prettier-ignore
type OkStatus = 200 | 201 | 202 | 203 | 204 | 206 | 207 | "2XX";
// prettier-ignore
type ErrorStatus = 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511 | "5XX" | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 420 | 421 | 422 | 423 | 424 | 425 | 426 | 429 | 431 | 444 | 450 | 451 | 497 | 498 | 499 | "4XX" | "default";

type MediaType = `${string}/${string}`;

type ResponseContent<T> = T extends { content: any } ? T["content"] : unknown;
type ResponseObjectMap<T> = T extends { responses: any }
  ? T["responses"]
  : unknown;

type ParseAsResponse<T, O> = O extends { parseAs: ParseAs }
  ? BodyType<T>[O["parseAs"]]
  : T;

type SuccessResponse<T> = ResponseContent<Dig<T, OkStatus>>;
type ErrorResponse<T> = ResponseContent<Dig<T, ErrorStatus>>;

type FetchResponse<TSchema, TInit> =
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
type PathsWithMethod<TPath, TMethod extends HttpMethod> = {
  [Pathname in keyof TPath]: TPath[Pathname] extends { [K in TMethod]: unknown }
    ? Pathname
    : never;
}[keyof TPath];

type PathMethods = Partial<Record<HttpMethod, {}>>;
type Paths = Record<string, PathMethods>;
// #endregion

// #region Client
type JsonBody<T> = T extends {
  requestBody: { content: { "application/json": infer B } };
}
  ? B
  : never;

// Generic inference defeats TypeScript's excess-property checks, so a body
// with fields the schema doesn't declare would compile fine — and strict
// (`extra="forbid"`) endpoints reject it at runtime with a 422. Mapping the
// unexpected keys to `never` restores the compile-time error.
type ExactBody<TOperation, TInit> = TInit extends { body: infer TBody }
  ? [JsonBody<TOperation>] extends [never]
    ? unknown
    : {
        body: {
          [K in Exclude<keyof TBody, keyof JsonBody<TOperation>>]: never;
        };
      }
  : unknown;

type ClientMethod<TPaths extends Paths, TMethod extends HttpMethod> = <
  TPath extends PathsWithMethod<TPaths, TMethod>,
  TInit extends FetchOptions<TPaths[TPath][TMethod]>
>(
  path: TPath,
  ...rest: HasRequiredKeys<TInit> extends true
    ? [init: TInit & ExactBody<TPaths[TPath][TMethod], TInit>]
    : [init?: TInit & ExactBody<TPaths[TPath][TMethod], TInit>]
) => Promise<FetchResponse<TPaths[TPath][TMethod], TInit>>;

export interface Client<TPaths extends {}> {
  get: ClientMethod<TPaths, "get">;
  put: ClientMethod<TPaths, "put">;
  post: ClientMethod<TPaths, "post">;
  delete: ClientMethod<TPaths, "delete">;
  options: ClientMethod<TPaths, "options">;
  head: ClientMethod<TPaths, "head">;
  patch: ClientMethod<TPaths, "patch">;
  trace: ClientMethod<TPaths, "trace">;
}

export interface ClientOptions {
  base?: string;
  middlewares?: FetchMiddleware[];
  fetch?: typeof fetch;
}

const isBodyInit = (body: any): boolean => {
  return (
    body instanceof Blob ||
    body instanceof ReadableStream ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
};

export const createClient = <TPaths extends {}>({
  base: baseUrl = "",
  middlewares = [],
  fetch: fetchThis,
}: ClientOptions = {}): Client<TPaths> => {
  // If we had set `fetch` above, `createClient` would've grabbed a copy of
  // fetch before we're able to mock it in tests
  const run = createAsyncMiddlewareRunner<[request: Request], Response>([
    ...middlewares,
    (request) => (fetchThis ?? fetch)(request),
  ]);

  const createHttpMethod = (method: HttpMethod) => {
    return async (
      path: string,
      {
        body,
        params,
        headers,
        parseAs = "json",
        ...init
      }: FetchOptions<{}> = {}
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
        serializePathParams(path, params?.path) +
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
        // if "stream", skip parsing entirely
        if (parseAs === "stream") {
          return { response, data: response.body };
        }

        return { response, data: await response[parseAs]() };
      }

      let error = await response.text();
      try {
        error = JSON.parse(error);
      } catch {
        // noop
      }

      return { response, error };
    };
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
const serializePathParams = (
  path: string,
  params: Record<string, unknown> = {}
): string => {
  return path.replace(/\{([^}]+)\}/g, (_match, key) => {
    return "" + params[key];
  });
};

export const serializeQueryParams = (
  params: Record<string, unknown> = {}
): string => {
  let searchParams: URLSearchParams | undefined;

  for (const key in params) {
    const value = params[key];

    if (value == null) {
      continue;
    }

    // lazily initialize search params
    searchParams ??= new URLSearchParams();

    if (Array.isArray(value)) {
      for (let idx = 0, len = value.length; idx < len; idx++) {
        const val = value[idx];
        searchParams.append(key, "" + val);
      }
    } else {
      searchParams.set(key, "" + value);
    }
  }

  return searchParams ? `?${searchParams.toString()}` : "";
};
// #endregion
