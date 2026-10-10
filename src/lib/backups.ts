// Daily backups to the team's own storage. Once a day (and on "Back up now")
// Flatdesk uploads one zip, the same one as Settings, Export, "Download
// everything", to a bucket the team owns on S3 or anything S3-compatible
// (Cloudflare R2, Backblaze B2, MinIO, Wasabi). Flatdesk never deletes
// anything there: keep as many days as you like and set the bucket's own
// lifecycle rule to expire old ones.

import { count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { archiveParts } from "@/lib/archive";
import { seal, unseal } from "@/lib/import/crypto";
import { putObject, S3Error } from "@/lib/s3";

const { backupTargets, attachments } = schema;
export type BackupTarget = typeof backupTargets.$inferSelect;

// Above this much attachment data a backup leaves the files out (the tables,
// help center and audit log still go) so the upload fits in one request.
export const BACKUP_FILES_LIMIT_BYTES = 100_000_000;
const RERUN_AFTER_MS = 20 * 3_600_000;

export class BackupError extends Error {}

export type BackupInput = { bucket: string; region: string; endpoint: string; prefix: string; accessKeyId: string; secretAccessKey: string; includeFiles: boolean; enabled: boolean };

export function cleanPrefix(raw: string): string {
  const p = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!p) return "";
  if (p.length > 100 || p.split("/").some((part) => part === ".." || part === ".")) throw new BackupError("Use a simple folder name like flatdesk/.");
  return p.endsWith("/") ? p : `${p}/`;
}

// Everything checked before anything is saved or uploaded.
export function checkBackupInput(i: BackupInput): { ok: true; bucket: string; region: string; endpoint: string | null; prefix: string } {
  const bucket = i.bucket.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..")) throw new BackupError("Enter the bucket's name, like acme-flatdesk-backups: lowercase letters, numbers, dots and hyphens.");
  const region = i.region.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,30}$/.test(region)) throw new BackupError("Enter the bucket's region, like us-east-1. Cloudflare R2 uses auto.");
  let endpoint: string | null = null;
  if (i.endpoint.trim()) {
    let u: URL;
    try {
      u = new URL(i.endpoint.trim());
    } catch {
      throw new BackupError("The endpoint doesn't look like a web address.");
    }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) throw new BackupError("The endpoint has to start with https:// and carry no password.");
    if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) throw new BackupError("Use the public address your storage service gave you, not an IP address or a local name.");
    endpoint = u.origin + u.pathname.replace(/\/$/, "");
  }
  return { ok: true, bucket, region, endpoint, prefix: cleanPrefix(i.prefix) };
}

export async function getBackupTarget(orgId: string): Promise<BackupTarget | null> {
  const [row] = await db.select().from(backupTargets).where(eq(backupTargets.orgId, orgId));
  return row ?? null;
}

const dayKey = (prefix: string, now: Date) => `${prefix}flatdesk-${now.toISOString().slice(0, 10)}.zip`;

// Saves the target after writing a small test file to it, so a wrong key or
// bucket shows up now and not at 2am.
export async function saveBackupTarget(orgId: string, userId: string, input: BackupInput, fetcherNow = new Date()): Promise<void> {
  const existing = await getBackupTarget(orgId);
  const checked = checkBackupInput(input);
  const accessKeyId = input.accessKeyId.trim() || (existing ? (unseal(existing.credentials).accessKeyId ?? "") : "");
  const secretAccessKey = input.secretAccessKey.trim() || (existing ? (unseal(existing.credentials).secretAccessKey ?? "") : "");
  if (accessKeyId.length < 10 || secretAccessKey.length < 20) throw new BackupError("Paste an access key ID and secret access key that can write to the bucket.");
  try {
    await putObject(
      { bucket: checked.bucket, region: checked.region, endpoint: checked.endpoint, accessKeyId, secretAccessKey },
      `${checked.prefix}flatdesk-connection-test.txt`,
      Buffer.from(`Flatdesk wrote this to check it can back up here. ${fetcherNow.toISOString()}\n`),
      "text/plain",
      fetcherNow,
    );
  } catch (err) {
    throw new BackupError(err instanceof S3Error ? err.message : "The storage service couldn't be reached. Check the endpoint and try again.");
  }
  const values = {
    bucket: checked.bucket,
    region: checked.region,
    endpoint: checked.endpoint,
    prefix: checked.prefix,
    credentials: seal({ accessKeyId, secretAccessKey }),
    includeFiles: input.includeFiles,
    enabled: input.enabled,
    lastError: null,
  };
  await db
    .insert(backupTargets)
    .values({ orgId, createdBy: userId, ...values })
    .onConflictDoUpdate({ target: backupTargets.orgId, set: values });
}

export async function removeBackupTarget(orgId: string) {
  await db.delete(backupTargets).where(eq(backupTargets.orgId, orgId));
}

// Builds the zip and uploads it. Records how it went either way. Never throws.
export async function runBackup(orgId: string, now = new Date()): Promise<{ ok: true; key: string; bytes: number; files: boolean } | { ok: false; error: string }> {
  const target = await getBackupTarget(orgId);
  if (!target) return { ok: false, error: "Backups aren't set up." };
  const record = (patch: Partial<BackupTarget>) => db.update(backupTargets).set({ lastRunAt: now, ...patch }).where(eq(backupTargets.orgId, orgId));
  try {
    const [totals] = await db.select({ n: count(), bytes: sql<string>`coalesce(sum(${attachments.size}), 0)` }).from(attachments).where(eq(attachments.orgId, orgId));
    const files = target.includeFiles && Number(totals.bytes) <= BACKUP_FILES_LIMIT_BYTES;
    const parts: Buffer[] = [];
    for await (const piece of archiveParts(orgId, { files })) parts.push(...piece);
    const body = Buffer.concat(parts);
    const key = dayKey(target.prefix, now);
    const creds = unseal(target.credentials);
    await putObject({ bucket: target.bucket, region: target.region, endpoint: target.endpoint, accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey }, key, body, "application/zip", now);
    await record({ lastOk: true, lastKey: key, lastBytes: body.length, lastError: files || !target.includeFiles ? null : `Attachment files were left out: your team has more than ${BACKUP_FILES_LIMIT_BYTES / 1_000_000} MB of them. The tables, help center and audit log were saved. "Download everything" has the files.` });
    return { ok: true, key, bytes: body.length, files };
  } catch (err) {
    const error = err instanceof S3Error ? err.message : err instanceof Error && err.name === "TimeoutError" ? "The storage service didn't answer in time." : "The backup couldn't be made or uploaded.";
    if (!(err instanceof S3Error)) console.error("backup failed", orgId, err);
    await record({ lastOk: false, lastError: error }).catch(() => {});
    return { ok: false, error };
  }
}

// The daily job: every team with backups on that hasn't had one in the last day.
export async function runDueBackups(budgetMs: number, now = new Date()): Promise<{ ran: number; failed: number }> {
  const rows = await db.select({ orgId: backupTargets.orgId, lastRunAt: backupTargets.lastRunAt }).from(backupTargets).where(eq(backupTargets.enabled, true));
  const started = Date.now();
  let ran = 0;
  let failed = 0;
  for (const r of rows) {
    if (Date.now() - started > budgetMs) break;
    if (r.lastRunAt && now.getTime() - r.lastRunAt.getTime() < RERUN_AFTER_MS) continue;
    const result = await runBackup(r.orgId, now);
    ran++;
    if (!result.ok) failed++;
  }
  return { ran, failed };
}
