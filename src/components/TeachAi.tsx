import { teachAiAction } from "@/app/app/actions";

// Sits right under the AI's handoff note: the team writes the missing answer
// once and the AI has it from then on.
export default function TeachAi({ ticketId, subject, customer }: { ticketId: string; subject: string; customer: string }) {
  return (
    <form action={teachAiAction} className="enter mt-2 grid gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm shadow-sm">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="grid gap-1">
        <p className="font-medium text-accent">Teach the AI this answer</p>
        <p className="text-muted">
          Write the answer once. It&apos;s saved as a saved answer the AI reads (you&apos;ll also find it under Macros), so the next customer who asks this gets it from the AI.
        </p>
      </div>
      <label className="grid gap-1.5 font-medium" htmlFor="teach-question">
        What the customer asked
        <input id="teach-question" name="question" required maxLength={200} defaultValue={subject} placeholder="How do I reset my password?" className="field font-normal bg-surface" />
      </label>
      <label className="grid gap-1.5 font-medium" htmlFor="teach-answer">
        The answer, as you&apos;d tell a customer
        <textarea
          id="teach-answer"
          name="answer"
          required
          rows={5}
          maxLength={8000}
          placeholder="Go to the sign-in page and click Forgot password. We email a reset link that works for 1 hour. If it doesn't arrive, check spam or reply here and we'll reset it for you."
          className="field font-normal bg-surface"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button name="send" value="on" className="btn btn-primary btn-sm">Save and send to {customer}</button>
        <button className="btn btn-secondary btn-sm">Save only</button>
      </div>
    </form>
  );
}
