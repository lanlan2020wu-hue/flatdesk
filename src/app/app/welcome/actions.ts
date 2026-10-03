"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { db, schema } from "@/db";
import type { OnboardingStep } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { clerkEnabled } from "@/lib/auth-config";
import { access } from "@/lib/billing";
import { emailConfig, inboundAddress, resend } from "@/lib/email";
import { milestone } from "@/lib/funnel";
import { hit, LIMITS } from "@/lib/rate-limit";
import { TEST_TAG, tryTheAi, updateOnboarding, type TryResult } from "@/lib/onboarding";
import { TestDriveError } from "@/lib/test-drive";
import { addSystemNote, createTicket, NO_AI_SETUP_NOTE } from "@/lib/tickets";

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const STEPS: OnboardingStep[] = ["ai", "invite", "inbox", "import", "test"];

export type InviteState = { sent: string[]; failed: { email: string; reason: string }[]; error: string | null };

export async function inviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const s = await requireAdmin();
  const raw = [...form.getAll("suggested").map(String), String(form.get("emails") ?? "")].join("\n");
  const emails = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const invalid = emails.filter((e) => !EMAIL.test(e));
  const valid = emails.filter((e) => EMAIL.test(e)).slice(0, 25);
  if (!valid.length) return { sent: [], failed: [], error: invalid.length ? `These don't look like email addresses: ${invalid.join(", ")}` : "Add at least one email address." };
  const role = form.get("role") === "admin" ? "org:admin" : "org:member";
  if (!(await hit(LIMITS.invites(s.orgId, valid.length))).ok) return { sent: [], failed: [], error: "That's a lot of invites for one day. Try again tomorrow." };

  const sent: string[] = [];
  const failed: InviteState["failed"] = invalid.map((email) => ({ email, reason: "Not an email address" }));
  if (clerkEnabled) {
    const clerk = await clerkClient();
    for (const emailAddress of valid) {
      try {
        await clerk.organizations.createOrganizationInvitation({ organizationId: s.orgId, emailAddress, role, inviterUserId: s.userId });
        sent.push(emailAddress);
      } catch (e) {
        const err = e as { errors?: { longMessage?: string; message?: string }[] };
        failed.push({ email: emailAddress, reason: err.errors?.[0]?.longMessage ?? err.errors?.[0]?.message ?? "Couldn't send the invite" });
      }
    }
  } else {
    // Local development has no Clerk: record the invite so the checklist can move on.
    sent.push(...valid);
  }
  if (sent.length) await updateOnboarding(s.orgId, (ob) => ({ ...ob, invited: [...new Set([...(ob.invited ?? []), ...sent])] }));
  if (sent.length) await milestone(s.orgId, "agent_invited", { count: sent.length });
  revalidatePath("/app/welcome");
  return { sent, failed, error: null };
}

export async function revokeInviteAction(form: FormData) {
  const s = await requireAdmin();
  const invitationId = String(form.get("invitationId"));
  if (clerkEnabled && invitationId) {
    await (await clerkClient()).organizations.revokeOrganizationInvitation({ organizationId: s.orgId, invitationId, requestingUserId: s.userId });
  }
  revalidatePath("/app/welcome");
}

export async function saveSupportEmailAction(form: FormData) {
  const s = await requireAdmin();
  const email = String(form.get("supportEmail") ?? "").trim().toLowerCase();
  if (email && !EMAIL.test(email)) throw new Error("That doesn't look like an email address.");
  await db.update(schema.orgs).set({ supportEmail: email || null }).where(eq(schema.orgs.id, s.orgId));
  revalidatePath("/app/welcome");
}

export async function confirmForwardingAction() {
  const s = await requireAdmin();
  await updateOnboarding(s.orgId, (ob) => ({ ...ob, forwardingConfirmed: true }));
  await milestone(s.orgId, "forwarding_confirmed");
  revalidatePath("/app/welcome");
}

export async function confirmWidgetAction() {
  const s = await requireAdmin();
  await updateOnboarding(s.orgId, (ob) => ({ ...ob, widgetAdded: true }));
  revalidatePath("/app/welcome");
}

export type TryState = { result: TryResult | null; question: string; error: string | null };

// Saves what the AI should know, then asks it the admin's question. Saving
// first means the answer reflects exactly what's in the box.
export async function tryAiAction(_prev: TryState, form: FormData): Promise<TryState> {
  const s = await requireAdmin();
  const notes = String(form.get("aiInstructions") ?? "").trim().slice(0, 20000);
  const question = String(form.get("question") ?? "").trim().slice(0, 2000);
  await db.update(schema.orgs).set({ aiInstructions: notes }).where(eq(schema.orgs.id, s.orgId));
  if (!question) return { result: null, question, error: "Type a question a customer might ask." };
  if (!(await hit(LIMITS.tryAi(s.orgId))).ok) return { result: null, question, error: "That's a lot of questions in an hour. Try again a bit later." };
  try {
    const result = await tryTheAi(s.orgId, question);
    revalidatePath("/app/welcome");
    revalidatePath("/app", "layout");
    return { result, question, error: null };
  } catch (e) {
    if (e instanceof TestDriveError) return { result: null, question, error: e.message };
    console.error("setup AI try failed", e);
    return { result: null, question, error: "The AI couldn't answer just now. Try again in a moment." };
  }
}

export async function skipStepAction(form: FormData) {
  const s = await requireAdmin();
  const step = String(form.get("step")) as OnboardingStep;
  if (!STEPS.includes(step)) return;
  await updateOnboarding(s.orgId, (ob) => ({ ...ob, skipped: [...new Set([...(ob.skipped ?? []), step])] }));
  await milestone(s.orgId, `skipped_${step}`);
  revalidatePath("/app/welcome");
}

export type TestState = { error: string | null; sentTo: string | null };

// Emails the team's own support address. If forwarding works, it comes back
// to Flatdesk as a ticket, which proves the whole path end to end.
export async function sendTestEmailAction(): Promise<TestState> {
  const s = await requireAdmin();
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  if (!org?.supportEmail) return { error: "Add your support address in the step above first.", sentTo: null };
  if (!emailConfig.apiKey || !emailConfig.from || !inboundAddress(org.inboundKey)) return { error: "Email isn't connected on this server yet.", sentTo: null };
  if (access(org).state === "locked") return { error: "Add a card in Settings to keep using Flatdesk.", sentTo: null };
  // Only to the team's own address, and not often: this sends from Flatdesk's domain.
  const verdict = await hit(LIMITS.testEmail(s.orgId));
  if (!verdict.ok) return { error: "That's a lot of test emails. Wait a few minutes, then check the forwarding rule before sending another.", sentTo: null };
  const token = `ft-${randomBytes(3).toString("hex")}`;
  const admin = await db.query.agents.findFirst({ where: and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, s.userId)), columns: { email: true } });
  await updateOnboarding(s.orgId, (ob) => ({ ...ob, testToken: token, testSentAt: new Date().toISOString(), testReplyTo: admin?.email || undefined }));
  const { error } = await resend().emails.send({
    from: `Flatdesk <${emailConfig.from}>`,
    to: org.supportEmail,
    subject: `Flatdesk test [${token}]`,
    text: [
      `This is a test from Flatdesk for ${org.name}.`,
      "",
      `If your support address forwards to Flatdesk, this email shows up in your inbox as a ticket in a few seconds.`,
      `You can reply to it to see what your customers receive, then close it.`,
    ].join("\n"),
  });
  if (error) return { error: `The test email couldn't be sent: ${error.message}`, sentTo: null };
  await milestone(s.orgId, "test_email_sent");
  revalidatePath("/app/welcome");
  return { error: null, sentTo: org.supportEmail };
}

export async function createSampleTicketAction() {
  const s = await requireAdmin();
  const ticket = await createTicket({
    orgId: s.orgId,
    channel: "email",
    customerEmail: "sam.sample@example.com",
    customerName: "Sam Sample",
    subject: "Test ticket: can you see this?",
    body: "Hi! This is a sample ticket so you can try Flatdesk. Reply to it, add an internal note, try a macro, then close it.",
    authorType: "customer",
    tags: [TEST_TAG],
  });
  await addSystemNote(s.orgId, ticket.id, NO_AI_SETUP_NOTE);
  await milestone(s.orgId, "sample_ticket_created");
  revalidatePath("/app/welcome");
  revalidatePath("/app", "layout");
}

export async function dismissOnboardingAction() {
  const s = await requireAdmin();
  await updateOnboarding(s.orgId, (ob) => ({ ...ob, dismissed: true }));
  await milestone(s.orgId, "onboarding_dismissed");
  redirect("/app/overview");
}
