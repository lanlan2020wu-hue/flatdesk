import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOnboarding } from "@/lib/onboarding";

export default async function AppHome() {
  const s = await requireSession();
  // New teams land on the setup checklist until they finish or hide it.
  if (s.role === "admin" && (await getOnboarding(s.orgId)).visible) redirect("/app/welcome");
  redirect("/app/inbox");
}
