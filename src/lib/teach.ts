import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { INPUT } from "./app-input";

// When the AI hands a ticket over because nothing it reads covers the question,
// the team can write the answer once, right under the handoff note. It's saved
// as a saved answer (a macro the AI reads), so the next customer who asks gets
// it from the AI.

export const HANDOFF_PREFIX = "AI handed this to the team:";
export const TAUGHT_PREFIX = "Taught the AI:";

type NoteLike = { authorType: string; internal: boolean; body: string };

// The handoff note to put the box under: the latest one, unless someone has
// already taught the AI since. -1 when there's nothing to teach.
export function teachSpot(thread: NoteLike[]) {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m.authorType !== "system") continue;
    if (m.body.startsWith(TAUGHT_PREFIX)) return -1;
    if (m.body.startsWith(HANDOFF_PREFIX)) return i;
  }
  return -1;
}

export class TeachError extends Error {}

// Saves the answer and leaves a note on the ticket saying who taught what.
export async function teachAi(opts: { orgId: string; ticketId: string; agentName: string; question: string; answer: string }) {
  const question = opts.question.trim();
  const answer = opts.answer.trim();
  if (!question || !answer) throw new TeachError("Write what the customer asked and the answer.");
  if (question.length > INPUT.macroName) throw new TeachError(`The question can be up to ${INPUT.macroName} characters.`);
  if (answer.length > INPUT.macroBody) throw new TeachError(`The answer can be up to ${INPUT.macroBody.toLocaleString("en-US")} characters.`);
  const ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, opts.orgId), eq(schema.tickets.id, opts.ticketId)) });
  if (!ticket) throw new TeachError("That ticket doesn't exist.");

  return db.transaction(async (tx) => {
    const [macro] = await tx
      .insert(schema.macros)
      .values({ orgId: opts.orgId, name: question, body: answer, question: question.slice(0, 300), source: "taught" })
      .returning();
    await tx.insert(schema.messages).values({
      orgId: opts.orgId,
      ticketId: ticket.id,
      authorType: "system",
      internal: true,
      body: `${TAUGHT_PREFIX} ${opts.agentName} saved "${question}" as a saved answer. Next time a customer asks this, the AI can answer on its own.`,
    });
    return { ticket, macro };
  });
}
