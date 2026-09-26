import type { Raw } from "./types";

// Errors the engine understands. RateLimited pauses the import until retryAt;
// ApiError with a 401/403 fails it with a message the admin can act on.
export class RateLimited extends Error {
  constructor(public retryAt: Date) {
    super("Rate limited");
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Longest pause taken inside a request; anything longer ends the step and the
// import resumes after Retry-After.
const MAX_INLINE_WAIT_MS = 8_000;

export function makeGetter(base: string, headers: Record<string, string>, fetchImpl: FetchLike = fetch) {
  const host = new URL(base).host;
  return async function get(pathOrUrl: string): Promise<{ data: Raw; headers: Headers }> {
    const url = new URL(pathOrUrl, base.endsWith("/") ? base : base + "/");
    // Pagination links come from the API; never follow them to another host.
    if (url.host !== host) throw new ApiError(400, `Refusing to fetch ${url.host}`);

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        if (attempt < 2) continue;
        throw new ApiError(0, `Couldn't reach ${host}: ${(e as Error).message}`);
      }
      if (res.status === 429 || res.status === 503) {
        const after = Number(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset") ?? 10);
        const waitMs = (Number.isFinite(after) && after > 0 ? after : 10) * 1000;
        if (waitMs <= MAX_INLINE_WAIT_MS && attempt < 3) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new RateLimited(new Date(Date.now() + waitMs));
      }
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (res.status === 401) throw new ApiError(401, "The API key or token was rejected. Check it and start the import again.");
      if (res.status === 403) throw new ApiError(403, `This account isn't allowed to read ${url.pathname}. An admin token is needed.`);
      if (!res.ok) throw new ApiError(res.status, `${host} answered ${res.status} for ${url.pathname}`);
      const text = await res.text();
      return { data: text ? JSON.parse(text) : {}, headers: res.headers };
    }
  };
}
