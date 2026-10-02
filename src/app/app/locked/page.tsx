import { redirect } from "next/navigation";
import { requireSession, teamPlan } from "@/lib/auth";

export const metadata = { title: "Free trial ended" };

// Pages behind the paywall send people here. The layout shows the paywall in
// place of this page, so it renders nothing of its own.
export default async function LockedPage() {
  const s = await requireSession();
  if ((await teamPlan(s.orgId)).plan.state !== "locked") redirect("/app/overview");
  return null;
}
