"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor, requireOpen } from "@/lib/auth";
import { CompanyError, normalizeCompanyDomain, saveCompany } from "@/lib/companies";

export async function saveCompanyAction(form: FormData) {
  const s = await requireOpen(await requireEditor());
  const domain = normalizeCompanyDomain(String(form.get("domain") ?? ""));
  if (!domain) redirect("/app/companies");
  let error = "";
  try {
    await saveCompany(s.orgId, domain, { name: String(form.get("name") ?? ""), notes: String(form.get("notes") ?? "") }, s.name);
  } catch (err) {
    if (!(err instanceof CompanyError)) throw err;
    error = err.message;
  }
  revalidatePath(`/app/companies/${domain}`);
  revalidatePath("/app/companies");
  redirect(`/app/companies/${domain}?${new URLSearchParams(error ? { error } : { saved: "1" })}`);
}
