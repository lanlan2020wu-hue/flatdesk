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

// A problem with what the admin typed (a malformed subdomain, a missing key).
// Its message is written for them and shown as is.
export class CredentialError extends Error {}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Longest pause taken inside a request; anything longer ends the step and the
// import resumes after Retry-After.
const MAX_INLINE_WAIT_MS = 8_000;

export function makeGetter(base: string, headers: Record<string, string>, fetchImpl: FetchLike = fetch) {
  const baseUrl = new URL(base);
  // Credentials go in headers, so they're only ever sent over https.
  if (baseUrl.protocol !== "https:") throw new Error(`Import API base must be https: ${base}`);
  const host = baseUrl.host;
  return async function get(pathOrUrl: string): Promise<{ data: Raw; headers: Headers }> {
    const url = new URL(pathOrUrl, base.endsWith("/") ? base : base + "/");
    // Pagination links come from the API; never follow them to another host or to plain http.
    if (url.host !== host || url.protocol !== "https:") {
      console.error("import: refused a link off the API host", url.protocol, url.host);
      throw new ApiError(400, "The old help desk sent a link Flatdesk won't follow. Try again, or contact support if it keeps happening.");
    }

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        if (attempt < 2) continue;
        console.error("import: request failed", host, url.pathname, e);
        throw new ApiError(0, `Couldn't reach ${host}. Try again in a few minutes.`);
      }
      if (res.status === 429 || res.status === 503) {
        // Retry-After is seconds; X-RateLimit-Reset is seconds on some APIs and a
        // Unix timestamp on others (Intercom), so a big value is read as a time.
        const after = Number(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset") ?? 10);
        const seconds = !Number.isFinite(after) || after <= 0 ? 10 : after > 1e9 ? after - Date.now() / 1000 : after;
        const waitMs = Math.min(Math.max(seconds, 1), 3600) * 1000;
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
      if (!res.ok) {
        // The answer's text is the old help desk's, not ours; it goes to the log only.
        console.error("import: API error", host, url.pathname, res.status, (await res.text().catch(() => "")).slice(0, 500));
        throw new ApiError(res.status, `${host} returned an error (${res.status}). Try again later.`);
      }
      const text = await res.text();
      try {
        return { data: text ? JSON.parse(text) : {}, headers: res.headers };
      } catch {
        console.error("import: unreadable JSON", host, url.pathname, text.slice(0, 200));
        throw new ApiError(502, `${host} sent an answer Flatdesk couldn't read. Try again later.`);
      }
    }
  };
}
