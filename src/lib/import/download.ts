import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { isPrivateAddress } from "@/lib/alerts";
import type { FetchLike } from "./http";

// Attachment downloads. Files live on hosts the old help desk names (signed
// storage links), so each hop is checked: https only, a bounded number of
// redirects, credentials only for the API's own host, and never a private
// address. The address is checked when the connection is made, so a name
// can't resolve to a public address for the check and a private one after.

const MAX_HOPS = 3;

export class BlockedUrl extends Error {}

function hostIsPrivateLiteral(u: URL) {
  const h = u.hostname.replace(/^\[|\]$/g, "");
  return isIP(h) !== 0 && isPrivateAddress(h);
}

// dns.lookup that refuses names resolving to any private address.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new BlockedUrl(`${hostname} resolves to a private address`), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    else callback(null, list[0].address, list[0].family);
  });
};

// One GET, no redirects followed, connected only to a public address.
export const pinnedFetch: FetchLike = (url, init = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "https:") return reject(new BlockedUrl("Only https links are copied"));
    if (hostIsPrivateLiteral(u)) return reject(new BlockedUrl("Private address"));
    const req = request(
      u,
      { method: "GET", headers: (init.headers ?? {}) as Record<string, string>, signal: init.signal ?? undefined, lookup: publicLookup },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x);
        const status = res.statusCode && res.statusCode >= 200 && res.statusCode <= 599 ? res.statusCode : 502;
        const empty = status === 204 || status === 304 || (status >= 300 && status < 400);
        if (empty) res.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });

// Follows up to MAX_HOPS redirects, checking every hop. headersFor decides,
// per hop, which headers go along (credentials only to the API host).
export async function safeDownload(
  url: URL,
  headersFor: (u: URL) => Record<string, string>,
  fetchImpl: FetchLike = pinnedFetch,
  signal: AbortSignal = AbortSignal.timeout(15_000),
): Promise<Response> {
  let u = url;
  for (let hop = 0; ; hop++) {
    if (u.protocol !== "https:") throw new BlockedUrl("Only https links are copied");
    if (hostIsPrivateLiteral(u)) throw new BlockedUrl("Private address");
    const res = await fetchImpl(u.toString(), { headers: headersFor(u), redirect: "manual", signal });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_HOPS) throw new BlockedUrl("Too many redirects");
    u = new URL(location, u);
  }
}

// Bytes a step or a message may still download.
export type Budget = { left: number };

// Reads a response body, giving up (and returning null) as soon as it passes
// limit bytes or any budget runs out. Bytes of a file given up on are handed back.
export async function readCapped(res: Response, limit: number, budgets: Budget[]): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const giveBack = () => {
    for (const b of budgets) b.left += total;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      for (const b of budgets) b.left -= value.length;
      if (total > limit || budgets.some((b) => b.left < 0)) {
        giveBack();
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch (e) {
    giveBack();
    throw e;
  }
  return Buffer.concat(chunks);
}
