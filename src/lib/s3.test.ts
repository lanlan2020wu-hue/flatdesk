import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { objectUrl, signRequest } from "./s3";

const creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", date: new Date("2013-05-24T00:00:00Z") };
const empty = createHash("sha256").update("").digest("hex");

// The worked examples in Amazon's Signature Version 4 documentation for S3.
test("signs the documented GET example", () => {
  const h = signRequest({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { range: "bytes=0-9" }, payloadHash: empty, ...creds });
  assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
});

test("signs the documented PUT example, including an encoded key", () => {
  const body = "Welcome to Amazon S3.";
  const h = signRequest({
    method: "PUT",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test$file.text",
    headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    payloadHash: createHash("sha256").update(body).digest("hex"),
    ...creds,
  });
  assert.match(h.authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test("AWS buckets use their own host; custom endpoints use the path form", () => {
  const aws = objectUrl({ bucket: "acme-backups", region: "eu-west-1" }, "flatdesk/2026-10-10.zip");
  assert.equal(aws.url.toString(), "https://acme-backups.s3.eu-west-1.amazonaws.com/flatdesk/2026-10-10.zip");
  const r2 = objectUrl({ bucket: "acme", region: "auto", endpoint: "https://abc.r2.cloudflarestorage.com" }, "a b/c.zip");
  assert.equal(r2.host, "abc.r2.cloudflarestorage.com");
  assert.equal(r2.path, "/acme/a b/c.zip");
  assert.equal(r2.url.pathname, "/acme/a%20b/c.zip");
});
