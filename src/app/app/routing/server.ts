"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin, requireOpen, requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { addAutoCloseTrigger, deleteGroup, saveGroup, setAway } from "@/lib/routing";
import { audit } from "@/lib/security";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").replace(/\0/g, "").trim();
const requireOpenAdmin = async () => requireOpen(await requireAdmin());
const back = (error?: string, at?: string): never => redirect(`/app/routing${error ? `?error=${encodeURIComponent(error)}` : ""}${at ? `#${at}` : ""}`);

export async function saveGroupAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  if (id && !isUuid(id)) back();
  const result = await saveGroup(s.orgId, {
    id: id || undefined,
    name: str(form, "name"),
    shareInTurn: form.get("shareInTurn") === "on",
    members: form.getAll("members").map(String),
  });
  if ("error" in result) back(result.error, id ? `group-${id}` : "new-group");
  await audit(s.orgId, { userId: s.userId, name: s.name }, "group.save", str(form, "name"));
  revalidatePath("/app/routing");
  back(undefined, `group-${(result as { id: string }).id}`);
}

export async function deleteGroupAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  if (!isUuid(id)) back();
  const gone = await deleteGroup(s.orgId, id);
  if (gone) await audit(s.orgId, { userId: s.userId, name: s.name }, "group.delete", gone.name);
  revalidatePath("/app/routing");
  back();
}

export async function saveRoutingAction(form: FormData) {
  const s = await requireOpenAdmin();
  await db.update(schema.orgs).set({ shareInTurn: form.get("shareInTurn") === "on" }).where(eq(schema.orgs.id, s.orgId));
  await audit(s.orgId, { userId: s.userId, name: s.name }, "settings.routing");
  revalidatePath("/app/routing");
  back(undefined, "team");
}

export async function addAutoCloseAction(form: FormData) {
  const s = await requireOpenAdmin();
  const result = await addAutoCloseTrigger(s.orgId, Number(str(form, "days")));
  if ("error" in result) back(result.error, "auto-close");
  await audit(s.orgId, { userId: s.userId, name: s.name }, "trigger.save", `Close pending tickets after ${str(form, "days")} days`);
  revalidatePath("/app/routing");
  revalidatePath("/app/macros");
  back(undefined, "auto-close");
}

// Anyone can mark themselves away; admins can mark anyone.
export async function setAwayAction(form: FormData) {
  const s = await requireOpen(await requireSession());
  const userId = str(form, "userId") || s.userId;
  if (userId !== s.userId && s.role !== "admin") back("Only admins can change someone else.");
  await setAway(s.orgId, userId, str(form, "away") === "true");
  revalidatePath("/app/routing");
  back(undefined, "people");
}
