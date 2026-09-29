"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireEditor } from "@/lib/auth";
import { rateDraft, startTestDrive, TestDriveError, VERDICT_LABEL, type Verdict } from "@/lib/test-drive";

export async function startTestDriveAction() {
  const s = await requireAdmin();
  let error = "";
  try {
    await startTestDrive(s.orgId);
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
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const verdict = Object.hasOwn(VERDICT_LABEL, raw) ? (raw as Verdict) : null;
  await rateDraft(s.orgId, id, verdict, s.userId);
  revalidatePath("/app/test-drive");
}
