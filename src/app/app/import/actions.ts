"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { ADAPTERS, cancelImport, ImportError, isSource, startImport } from "@/lib/import/engine";

export type StartState = { error: string | null; values: Record<string, string> };

export async function startImportAction(_prev: StartState, form: FormData): Promise<StartState> {
  const s = await requireAdmin();
  const source = String(form.get("source"));
  if (!isSource(source)) return { error: "Pick a help desk to import from.", values: {} };
  const adapter = ADAPTERS[source];
  const creds: Record<string, string> = {};
  for (const f of adapter.credentialFields) creds[f.name] = String(form.get(f.name) ?? "").trim();
  // Echo back only the non-secret fields so a failed attempt keeps what was typed.
  const values = Object.fromEntries(adapter.credentialFields.filter((f) => !f.secret).map((f) => [f.name, creds[f.name]]));
  if (adapter.credentialFields.some((f) => !creds[f.name])) return { error: "Fill in every field.", values };

  let id: string;
  try {
    ({ id } = await startImport({ orgId: s.orgId, userId: s.userId, source, creds }));
  } catch (e) {
    if (e instanceof ImportError) return { error: e.message, values };
    throw e;
  }
  redirect(`/app/import/${id}`);
}

export async function cancelImportAction(form: FormData) {
  const s = await requireAdmin();
  const id = String(form.get("id"));
  await cancelImport(s.orgId, id);
  redirect(`/app/import/${id}`);
}
