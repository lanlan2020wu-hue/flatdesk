"use server";

import { revalidatePath } from "next/cache";
import { requireEditor, requireOpen } from "@/lib/auth";
import { InsightsError, runInsights } from "@/lib/insights";
import { REPORT_RANGES } from "@/lib/reports";

export async function runInsightsAction(days: number): Promise<{ error: string } | { ok: true }> {
  const s = await requireOpen(await requireEditor());
  const window = (REPORT_RANGES as readonly number[]).includes(days) ? days : 30;
  try {
    await runInsights(s.orgId, s.userId, window);
  } catch (err) {
    if (err instanceof InsightsError) return { error: err.message };
    console.error("insights failed", err);
    return { error: "Insights didn't finish. Try again in a few minutes." };
  }
  revalidatePath("/app/reports");
  return { ok: true };
}
