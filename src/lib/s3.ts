// Uploads one object to an S3 bucket (or anything that speaks S3: Cloudflare
// R2, Backblaze B2, MinIO, Wasabi), signing the request with AWS Signature
// Version 4. Written out here so backups need no SDK.

import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isPrivateAddress, publicLookup } from "@/lib/alerts";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding that also encodes the characters encodeURIComponent leaves.
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (p: string) => p.split("/").map(encode).join("/");

export type SignInput = {
  method: string;
  host: string;
  path: string; // already the URL path, not yet encoded
  query?: string;
  headers?: Record<string, string>; // extra headers to sign; host and x-amz-* are added
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
  service?: string;
};

// The headers to send, including Authorization.
export function signRequest(i: SignInput): Record<string, string> {
  const amzDate = i.date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const service = i.service ?? "s3";
  const headers: Record<string, string> = { ...i.headers, host: i.host, "x-amz-content-sha256": i.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const byName = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const canonical = [i.method, encodePath(i.path), i.query ?? "", ...names.map((n) => `${n}:${byName[n]}`), "", names.join(";"), i.payloadHash].join("\n");
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...byName, authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

export type S3Target = { bucket: string; region: string; endpoint?: string | null; accessKeyId: string; secretAccessKey: string };

export class S3Error extends Error {}

// Where an object lives: the bucket's own host on AWS, the path-style form on a custom endpoint.
export function objectUrl(t: Pick<S3Target, "bucket" | "region" | "endpoint">, key: string): { url: URL; host: string; path: string } {
  const path = t.endpoint ? `${new URL(t.endpoint).pathname.replace(/\/$/, "")}/${t.bucket}/${key}` : `/${key}`;
  const base = t.endpoint ? new URL(t.endpoint) : new URL(`https://${t.bucket}.s3.${t.region}.amazonaws.com`);
  const url = new URL(base.origin);
  url.pathname = encodePath(path);
  return { url, host: base.host, path };
}

const allowPrivate = () => process.env.ALERTS_ALLOW_PRIVATE === "1";

export async function putObject(t: S3Target, key: string, body: Buffer, contentType = "application/octet-stream", now = new Date(), timeoutMs = 120_000): Promise<void> {
  const { url, host, path } = objectUrl(t, key);
  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:")) throw new S3Error("The storage address has to start with https://.");
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare) && !allowPrivate() && isPrivateAddress(bare)) throw new S3Error("The storage address doesn't resolve to a public server.");
  const headers = signRequest({
    method: "PUT",
    host,
    path,
    headers: { "content-type": contentType },
    payloadHash: sha256(body),
    region: t.region,
    accessKeyId: t.accessKeyId,
    secretAccessKey: t.secretAccessKey,
    date: now,
  });
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = send(url, { method: "PUT", headers: { ...headers, "content-length": String(body.length) }, lookup: publicLookup, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        if (size < 4000) chunks.push(c);
        size += c.length;
      });
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
      });
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })), timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end(body);
  });
  if (status >= 200 && status < 300) return;
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  const hints: Record<string, string> = {
    InvalidAccessKeyId: "The access key ID isn't recognised.",
    SignatureDoesNotMatch: "The secret access key (or the region) is wrong.",
    NoSuchBucket: "That bucket doesn't exist, or is in another region.",
    AccessDenied: "That key isn't allowed to write to the bucket. It needs s3:PutObject.",
    AuthorizationHeaderMalformed: "The region doesn't match the bucket's.",
    PermanentRedirect: "The bucket is in another region.",
  };
  throw new S3Error((code && hints[code]) || `The storage service answered ${status}${code ? ` (${code})` : ""}.`);
}
