"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { RefundError, refundResolution } from "@/lib/receipts";

export async function refundAction(form: FormData) {
  const s = await requireAdmin();
  const eventId = String(form.get("eventId") ?? "");
  const month = String(form.get("month") ?? "");
  const note = String(form.get("note") ?? "").trim();
  let error = "";
  try {
    await refundResolution(s.orgId, eventId, { userId: s.userId, name: s.name }, note);
  } catch (err) {
    if (!(err instanceof RefundError)) throw err;
    error = err.message;
  }
  revalidatePath("/app/receipts");
  revalidatePath("/app/inbox");
  const q = new URLSearchParams({ month, ...(error ? { error } : { refunded: eventId }) });
  redirect(`/app/receipts?${q}#e-${eventId}`);
}
