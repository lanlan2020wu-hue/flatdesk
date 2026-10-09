"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { answerNewTicket } from "@/lib/ai";
import { triageTicket } from "@/lib/triage";
import { alertNewTicket } from "@/lib/alerts";
import { requireAdmin, requireOpen } from "@/lib/auth";
import { hit, LIMITS } from "@/lib/rate-limit";
import { clearTestTickets, createTestTicket, customerWritesBack, ownEmail, parseTestForm, TestTicketError } from "@/lib/test-tickets";
import { shareTicketQuietly } from "@/lib/routing";

const PAGE = "/app/test-tickets";

function back(error?: string): never {
  revalidatePath(PAGE);
  revalidatePath("/app", "layout");
  redirect(error ? `${PAGE}?${new URLSearchParams({ error })}` : PAGE);
}

async function limited(orgId: string) {
  return !(await hit(LIMITS.testTickets(orgId))).ok;
}

export async function createTestTicketAction(form: FormData) {
  const s = await requireOpen(await requireAdmin());
  let error: string | undefined;
  try {
    if (await limited(s.orgId)) throw new TestTicketError("That's a lot of test tickets. Wait a while, or clear some first.");
    const input = parseTestForm(form, await ownEmail(s.orgId, s.userId));
    const ticket = await createTestTicket(s.orgId, input, String(form.get("scenario") ?? "") || undefined);
    // The same steps the email and chat routes run after a new ticket.
    after(async () => {
      await Promise.all([triageTicket(s.orgId, ticket.id), answerNewTicket(s.orgId, ticket.id)]);
      await shareTicketQuietly(s.orgId, ticket.id);
      await alertNewTicket(s.orgId, ticket.id);
    });
  } catch (err) {
    if (!(err instanceof TestTicketError)) throw err;
    error = err.message;
  }
  back(error);
}

export async function writeBackAction(form: FormData) {
  const s = await requireOpen(await requireAdmin());
  let error: string | undefined;
  try {
    if (await limited(s.orgId)) throw new TestTicketError("That's a lot of test messages. Wait a while and try again.");
    const ticket = await customerWritesBack(s.orgId, String(form.get("number") ?? ""), String(form.get("body") ?? ""));
    // As the email route does for a reply: the AI answers a follow-up or hands the ticket back.
    after(() => answerNewTicket(s.orgId, ticket.id));
  } catch (err) {
    if (!(err instanceof TestTicketError)) throw err;
    error = err.message;
  }
  back(error);
}

export async function clearTestTicketsAction() {
  const s = await requireOpen(await requireAdmin());
  await clearTestTickets(s.orgId);
  back();
}
