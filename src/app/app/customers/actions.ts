"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor, requireOpen } from "@/lib/auth";
import { CustomerProfileError, saveCustomerProfile } from "@/lib/customer-profile";
import { isUuid } from "@/lib/ids";

export async function saveCustomerProfileAction(form: FormData) {
  const s = await requireOpen(await requireEditor());
  const customerId = String(form.get("customerId") ?? "");
  const number = Number(form.get("number"));
  if (!isUuid(customerId) || !Number.isInteger(number) || number < 1) redirect("/app/inbox");
  let error = "";
  try {
    await saveCustomerProfile(s.orgId, customerId, { notes: form.get("notes"), vip: form.get("vip") === "on" });
  } catch (err) {
    if (!(err instanceof CustomerProfileError)) throw err;
    error = err.message;
  }
  revalidatePath(`/app/tickets/${number}`);
  revalidatePath("/app/inbox");
  redirect(`/app/tickets/${number}${error ? `?${new URLSearchParams({ customer: error })}` : ""}`);
}
