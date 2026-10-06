"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import type { AiActionInput } from "@/db/schema";
import { BUILT_IN, decideRun, MAX_ACTIONS, MAX_INPUTS, type ActionKind } from "@/lib/ai-actions";
import { checkWebhookUrl } from "@/lib/alerts";
import { requireAdmin, requireEditor, requireOpen } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { hit } from "@/lib/rate-limit";
import { audit } from "@/lib/security";

const { aiActions, orgs } = schema;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").replace(/\0/g, "").trim();
const requireOpenAdmin = async () => requireOpen(await requireAdmin());
const back = (error?: string, at?: string): never => redirect(`/app/actions${error ? `?error=${encodeURIComponent(error)}` : ""}${at ? `#${at}` : ""}`);

// "name: what it is", one per line -> inputs the AI fills in.
export async function parseInputs(raw: string): Promise<AiActionInput[] | { error: string }> {
  const out: AiActionInput[] = [];
  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [head, ...rest] = line.split(":");
    const name = head.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) return { error: `"${head.trim().slice(0, 40)}" can't be an input name. Use letters, numbers and underscores, like order_number.` };
    if (out.some((i) => i.name === name)) return { error: `${name} is listed twice.` };
    out.push({ name, description: rest.join(":").trim().slice(0, 300) || name.replace(/_/g, " ") });
  }
  if (out.length > MAX_INPUTS) return { error: `An action can have up to ${MAX_INPUTS} inputs.` };
  return out;
}

// "25", "25.50" or "" (no limit) -> cents.
function limit(raw: string): number | null | { error: string } {
  if (!raw) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return { error: "The limit should be an amount like 50 or 49.99." };
  return Math.round(Number(raw) * 100);
}

async function count(orgId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(aiActions).where(eq(aiActions.orgId, orgId));
  return Number(n);
}

export async function addBuiltInAction(form: FormData) {
  const s = await requireOpenAdmin();
  const kind = str(form, "kind") as Exclude<ActionKind, "webhook">;
  const b = BUILT_IN[kind];
  if (!b) back("That isn't an action Flatdesk has.");
  if ((await count(s.orgId)) >= MAX_ACTIONS) back(`A team can have up to ${MAX_ACTIONS} actions.`);
  const [row] = await db
    .insert(aiActions)
    .values({ orgId: s.orgId, kind, name: b.name, whenToUse: b.whenToUse, approval: "always", createdBy: s.userId })
    .onConflictDoNothing()
    .returning({ id: aiActions.id });
  if (row) await audit(s.orgId, { userId: s.userId, name: s.name }, "action.change", `Added ${b.name}`);
  revalidatePath("/app/actions");
  back(undefined, row ? `action-${row.id}` : undefined);
}

export type NewActionState = { error: string | null; secret?: string; id?: string };

export async function addWebhookAction(_: NewActionState, form: FormData): Promise<NewActionState> {
  const s = await requireOpenAdmin();
  if (!(await hit([{ key: `action-change:${s.orgId}`, max: 60, windowSec: 3600 }])).ok) return { error: "That's a lot of changes. Try again in an hour." };
  if ((await count(s.orgId)) >= MAX_ACTIONS) return { error: `A team can have up to ${MAX_ACTIONS} actions.` };
  const name = str(form, "name").slice(0, 80);
  if (!name) return { error: "Give the action a name, like Send a password reset." };
  const url = checkWebhookUrl(str(form, "url"));
  if ("error" in url) return { error: url.error };
  const inputs = await parseInputs(str(form, "inputs"));
  if ("error" in inputs) return inputs;
  const lookup = form.get("lookup") === "on";
  const [row] = await db
    .insert(aiActions)
    .values({
      orgId: s.orgId,
      kind: "webhook",
      name,
      whenToUse: str(form, "whenToUse").slice(0, 1000),
      url: url.url,
      inputs,
      lookup,
      approval: lookup ? "never" : "always",
      createdBy: s.userId,
    })
    .returning();
  await audit(s.orgId, { userId: s.userId, name: s.name }, "action.change", `Added ${name}`);
  revalidatePath("/app/actions");
  return { error: null, secret: row.secret, id: row.id };
}

export async function saveAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  if (!isUuid(id)) back("That action doesn't exist.");
  const [a] = await db.select().from(aiActions).where(and(eq(aiActions.orgId, s.orgId), eq(aiActions.id, id)));
  if (!a) back("That action doesn't exist.");
  const approval = str(form, "approval");
  if (!["always", "over_limit", "never"].includes(approval)) back("Pick when a person approves.", `action-${id}`);
  const cents = limit(str(form, "limit"));
  if (cents && typeof cents === "object") back(cents.error, `action-${id}`);
  if (approval === "over_limit" && cents === null) back("Set the amount the AI can do on its own, or pick another option.", `action-${id}`);
  const set: Partial<typeof aiActions.$inferInsert> = {
    whenToUse: str(form, "whenToUse").slice(0, 1000),
    approval: a.lookup ? "never" : (approval as "always" | "over_limit" | "never"),
    limitCents: cents as number | null,
    enabled: form.get("enabled") === "on",
    updatedAt: new Date(),
  };
  if (a.kind === "webhook") {
    const name = str(form, "name").slice(0, 80);
    if (name) set.name = name;
    const url = checkWebhookUrl(str(form, "url"));
    if ("error" in url) back(url.error, `action-${id}`);
    else set.url = url.url;
    const inputs = await parseInputs(str(form, "inputs"));
    if ("error" in inputs) back(inputs.error, `action-${id}`);
    else set.inputs = inputs;
  }
  await db.update(aiActions).set(set).where(eq(aiActions.id, id));
  await audit(s.orgId, { userId: s.userId, name: s.name }, "action.change", `Changed ${set.name ?? a.name}: ${set.enabled ? "on" : "off"}, approval ${set.approval}${cents ? ` over ${(Number(cents) / 100).toFixed(2)}` : ""}`);
  revalidatePath("/app/actions");
  back(undefined, `action-${id}`);
}

export async function deleteAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  if (!isUuid(id)) back();
  const [row] = await db.delete(aiActions).where(and(eq(aiActions.orgId, s.orgId), eq(aiActions.id, id))).returning({ name: aiActions.name });
  if (row) await audit(s.orgId, { userId: s.userId, name: s.name }, "action.change", `Deleted ${row.name}`);
  revalidatePath("/app/actions");
  back();
}

export async function setReadsRecords(form: FormData) {
  const s = await requireOpenAdmin();
  const on = form.get("on") === "1";
  await db.update(orgs).set({ aiReadsRecords: on }).where(eq(orgs.id, s.orgId));
  await audit(s.orgId, { userId: s.userId, name: s.name }, "action.change", on ? "The AI reads orders and payments" : "The AI doesn't read orders and payments");
  revalidatePath("/app/actions");
  back(undefined, "records");
}

// Approve or Decline on a ticket.
export async function decideAction(form: FormData) {
  const s = await requireOpen(await requireEditor());
  const runId = str(form, "runId");
  const number = str(form, "number");
  const to = /^\d+$/.test(number) ? `/app/tickets/${number}` : "/app/actions";
  if (!isUuid(runId)) redirect(to);
  if (!(await hit([{ key: `action-decide:${s.orgId}`, max: 120, windowSec: 3600 }])).ok) redirect(`${to}?action=${encodeURIComponent("That's a lot of approvals this hour. Try again later.")}`);
  const approve = str(form, "decision") === "approve";
  const result = await decideRun(s.orgId, runId, { userId: s.userId, name: s.name }, approve);
  await audit(s.orgId, { userId: s.userId, name: s.name }, "action.decide", `${approve ? "Approved" : "Declined"} an AI action on ticket #${number}`);
  revalidatePath(to);
  redirect(`${to}?action=${encodeURIComponent("error" in result ? result.error : result.message)}`);
}
