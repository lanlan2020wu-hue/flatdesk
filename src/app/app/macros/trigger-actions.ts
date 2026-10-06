"use server";

import { and, asc, count, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { findAssignable } from "@/lib/agents";
import { requireAdmin, requireOpen } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { audit } from "@/lib/security";
import { normalizeTags } from "@/lib/tickets";
import { MAX_TRIGGERS, triggerFromForm } from "@/lib/triggers";

const { triggers } = schema;
const requireOpenAdmin = async () => requireOpen(await requireAdmin());
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (msg?: string) => redirect(`/app/macros${msg ? `?trigger=${encodeURIComponent(msg)}` : ""}#triggers`);

export async function saveTriggerAction(form: FormData) {
  const s = await requireOpenAdmin();
  const parsed = triggerFromForm((k) => str(form, k), normalizeTags);
  if ("error" in parsed) back(parsed.error);
  const t = parsed as Exclude<typeof parsed, { error: string }>;
  const assign = t.actions.find((a) => a.type === "assign");
  if (assign && assign.type === "assign" && !(await findAssignable(s.orgId, assign.to))) back("Pick someone on this team who can take tickets.");
  const id = str(form, "id");
  if (id) {
    if (!isUuid(id)) back();
    await db.update(triggers).set(t).where(and(eq(triggers.orgId, s.orgId), eq(triggers.id, id)));
  } else {
    const [{ n, last }] = await db.select({ n: count(), last: max(triggers.position) }).from(triggers).where(eq(triggers.orgId, s.orgId));
    if (Number(n) >= MAX_TRIGGERS) back(`A team can have up to ${MAX_TRIGGERS} triggers.`);
    await db.insert(triggers).values({ orgId: s.orgId, ...t, position: (last ?? -1) + 1 });
  }
  await audit(s.orgId, { userId: s.userId, name: s.name }, "trigger.save", t.name);
  revalidatePath("/app/macros");
  back();
}

export async function toggleTriggerAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  if (!isUuid(id)) return;
  await db.update(triggers).set({ enabled: str(form, "enabled") === "true" }).where(and(eq(triggers.orgId, s.orgId), eq(triggers.id, id)));
  revalidatePath("/app/macros");
}

export async function deleteTriggerAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  if (!isUuid(id)) return;
  const [gone] = await db.delete(triggers).where(and(eq(triggers.orgId, s.orgId), eq(triggers.id, id))).returning({ name: triggers.name });
  if (gone) await audit(s.orgId, { userId: s.userId, name: s.name }, "trigger.delete", gone.name);
  revalidatePath("/app/macros");
}

// Swaps a trigger with the one above it, since order decides which runs first.
export async function moveTriggerUpAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  const list = await db.select({ id: triggers.id }).from(triggers).where(eq(triggers.orgId, s.orgId)).orderBy(asc(triggers.position), asc(triggers.createdAt));
  const i = list.findIndex((t) => t.id === id);
  if (i <= 0) return;
  [list[i - 1], list[i]] = [list[i], list[i - 1]];
  await db.transaction(async (tx) => {
    for (const [position, t] of list.entries()) await tx.update(triggers).set({ position }).where(and(eq(triggers.orgId, s.orgId), eq(triggers.id, t.id)));
  });
  revalidatePath("/app/macros");
}
