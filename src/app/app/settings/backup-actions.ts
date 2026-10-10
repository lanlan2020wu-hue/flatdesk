"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireOpen } from "@/lib/auth";
import { BackupError, removeBackupTarget, runBackup, saveBackupTarget } from "@/lib/backups";
import { hit } from "@/lib/rate-limit";
import { audit } from "@/lib/security";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (message: string) => `/app/settings?${new URLSearchParams({ backup: message })}#backups`;

export async function saveBackupAction(form: FormData) {
  const s = await requireOpen(await requireAdmin());
  // Each save writes a test file to their storage.
  if (!(await hit([{ key: `backup-save:${s.orgId}`, max: 20, windowSec: 3600 }])).ok) redirect(back("That's a lot of tries. Wait an hour and try again."));
  let message = "saved";
  try {
    await saveBackupTarget(s.orgId, s.userId, {
      bucket: str(form, "bucket"),
      region: str(form, "region"),
      endpoint: str(form, "endpoint"),
      prefix: str(form, "prefix"),
      accessKeyId: str(form, "accessKeyId"),
      secretAccessKey: str(form, "secretAccessKey"),
      includeFiles: form.get("includeFiles") === "on",
      enabled: form.get("enabled") === "on",
    });
    await audit(s.orgId, { userId: s.userId, name: s.name }, "backup.save", `${str(form, "bucket")}`);
  } catch (err) {
    if (!(err instanceof BackupError)) throw err;
    message = err.message;
  }
  revalidatePath("/app/settings");
  redirect(back(message));
}

export async function backUpNowAction() {
  const s = await requireOpen(await requireAdmin());
  if (!(await hit([{ key: `backup-now:${s.orgId}`, max: 6, windowSec: 3600 }])).ok) redirect(back("That's a lot of backups for one hour. Try again later."));
  const result = await runBackup(s.orgId);
  revalidatePath("/app/settings");
  redirect(back(result.ok ? "ran" : `The backup failed: ${result.error}`));
}

export async function removeBackupAction() {
  const s = await requireOpen(await requireAdmin());
  await removeBackupTarget(s.orgId);
  await audit(s.orgId, { userId: s.userId, name: s.name }, "backup.remove");
  revalidatePath("/app/settings");
  redirect(back("removed"));
}
