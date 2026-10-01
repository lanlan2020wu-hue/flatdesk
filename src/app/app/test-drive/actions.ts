"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireEditor } from "@/lib/auth";
import { milestone } from "@/lib/funnel";
import { rateDraft, startTestDrive, TestDriveError, VERDICT_LABEL, type Verdict } from "@/lib/test-drive";
import { isUuid } from "@/lib/ids";

export async function startTestDriveAction() {
  const s = await requireAdmin();
  let error = "";
  try {
    await startTestDrive(s.orgId);
    await milestone(s.orgId, "test_drive_started");
  } catch (err) {
    if (!(err instanceof TestDriveError)) throw err;
    error = err.message;
  }
  revalidatePath("/app/test-drive");
  redirect(error ? `/app/test-drive?${new URLSearchParams({ error })}` : "/app/test-drive");
}

export async function rateDraftAction(form: FormData) {
  const s = await requireEditor();
  const id = String(form.get("id") ?? "");
  const raw = String(form.get("verdict") ?? "");
  if (!isUuid(id)) return;
  const verdict = Object.hasOwn(VERDICT_LABEL, raw) ? (raw as Verdict) : null;
  await rateDraft(s.orgId, id, verdict, s.userId);
  revalidatePath("/app/test-drive");
}
