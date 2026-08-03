import { mock } from "bun:test";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function parseUrl(input: Request | string): URL {
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

export type RecordedRequest = {
  method: string;
  pathname: string;
  body?: unknown;
};

export type RouteHandler = (
  request: Request,
  url: URL,
) => Response | Promise<Response | undefined> | undefined;

/**
 * Replaces globalThis.fetch with a mock that:
 * - Records every request (method, pathname, parsed body) into the returned array.
 * - Tries each handler in order; the first to return a Response wins.
 * - Falls back to an empty paginated list ({ results: [], count: 0 }).
 */
export function mockFetch(...handlers: RouteHandler[]): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = mock(async (input: Request | string) => {
    const url = parseUrl(input);
    const request = typeof input === "string" ? new Request(input) : input;
    let body: unknown;
    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        const cloned = request.clone();
        const ct = cloned.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) body = await cloned.json();
        else if (ct.includes("multipart/form-data")) body = "<form-data>";
      } catch {
        // ignore body parse failures — recording is best-effort
      }
    }
    recorded.push({ method: request.method, pathname: url.pathname, body });

    for (const handler of handlers) {
      const response = await handler(request, url);
      if (response) return response;
    }
    return jsonResponse({ results: [], count: 0 });
  }) as unknown as typeof fetch;
  return recorded;
}

export async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of generator) items.push(item);
  return items;
}
