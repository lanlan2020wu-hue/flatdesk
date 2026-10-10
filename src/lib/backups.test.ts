// Backups to the team's own storage. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { checkBackupInput, cleanPrefix, BackupError } from "./backups";

process.env.ALERTS_ALLOW_PRIVATE = "1";
process.env.INBOUND_DOMAIN = "in.flatdesk.test";
const ORG = "org_test_backups";
const input = { bucket: "acme-backups", region: "us-east-1", endpoint: "", prefix: "flatdesk", accessKeyId: "AKIAEXAMPLE12345", secretAccessKey: "x".repeat(40), includeFiles: true, enabled: true };

test("folder names are tidied and can't climb out of the bucket", () => {
  assert.equal(cleanPrefix(""), "");
  assert.equal(cleanPrefix("/flatdesk"), "flatdesk/");
  assert.equal(cleanPrefix("a//b/"), "a/b/");
  assert.throws(() => cleanPrefix("../x"), BackupError);
  assert.throws(() => cleanPrefix("a/./b"), BackupError);
});

test("bucket, region and endpoint are checked before anything is sent", () => {
  assert.deepEqual(checkBackupInput(input), { ok: true, bucket: "acme-backups", region: "us-east-1", endpoint: null, prefix: "flatdesk/" });
  assert.equal(checkBackupInput({ ...input, region: "auto", endpoint: "https://abc.r2.cloudflarestorage.com/" }).endpoint, "https://abc.r2.cloudflarestorage.com");
  for (const bad of [{ bucket: "A_B" }, { bucket: "a" }, { region: "us east" }, { endpoint: "http://s3.example.com" }, { endpoint: "https://169.254.169.254" }, { endpoint: "https://localhost" }, { endpoint: "https://user:pw@s3.example.com" }, { endpoint: "nonsense" }]) {
    assert.throws(() => checkBackupInput({ ...input, ...bad }), BackupError, JSON.stringify(bad));
  }
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: a backup uploads a signed zip of the team's data, and records how it went", async () => {
    const { db, schema } = await import("@/db");
    const { seal } = await import("./import/crypto");
    const { getBackupTarget, runBackup, runDueBackups } = await import("./backups");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, inboundKey: "backupskey001" });

    const seen: { method?: string; url?: string; auth?: string; type?: string; body: Buffer[] }[] = [];
    let status = 200;
    const server = createServer((req, res) => {
      const entry = { method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], body: [] as Buffer[] };
      seen.push(entry);
      req.on("data", (c: Buffer) => entry.body.push(c));
      req.on("end", () => {
        res.statusCode = status;
        res.end(status === 200 ? "" : "<Error><Code>AccessDenied</Code></Error>");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as { port: number };
      await db.insert(schema.backupTargets).values({ orgId: ORG, bucket: "acme", region: "us-east-1", endpoint: `http://127.0.0.1:${port}`, prefix: "fd/", credentials: seal({ accessKeyId: "AKIAEXAMPLE12345", secretAccessKey: "s".repeat(40) }), createdBy: "user_ada" });

      const now = new Date("2026-10-10T09:00:00Z");
      const ok = await runBackup(ORG, now);
      assert.ok(ok.ok);
      assert.equal(seen[0].method, "PUT");
      assert.equal(seen[0].url, "/acme/fd/flatdesk-2026-10-10.zip");
      assert.equal(seen[0].type, "application/zip");
      assert.match(seen[0].auth ?? "", /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE12345\/20261010\/us-east-1\/s3\/aws4_request/);
      const zip = Buffer.concat(seen[0].body);
      assert.equal(zip.readUInt32LE(0), 0x04034b50, "a zip");
      assert.ok(zip.includes(Buffer.from("tickets.json")) && zip.includes(Buffer.from("audit-log.json")));
      const row = await getBackupTarget(ORG);
      assert.equal(row?.lastOk, true);
      assert.equal(row?.lastKey, "fd/flatdesk-2026-10-10.zip");

      // Already backed up today: the daily job leaves it.
      assert.deepEqual(await runDueBackups(10_000, new Date("2026-10-10T12:00:00Z")), { ran: 0, failed: 0 });
      // A day later it runs, and a refusal is recorded in words.
      status = 403;
      assert.deepEqual(await runDueBackups(10_000, new Date("2026-10-11T09:00:00Z")), { ran: 1, failed: 1 });
      const failed = await getBackupTarget(ORG);
      assert.equal(failed?.lastOk, false);
      assert.match(failed?.lastError ?? "", /isn't allowed to write/);
    } finally {
      server.close();
    }
  });
}
