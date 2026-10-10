import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOpenPage } from "@/lib/auth";
import { composeTicketAction } from "../../actions";

export const metadata = { title: "Email a customer" };

// The team starts the conversation: a first email to someone who hasn't written in.
// The customer's replies come back to the same ticket.
export default async function ComposePage({ searchParams }: PageProps<"/app/tickets/compose">) {
  const s = await requireOpenPage();
  if (s.viewer) notFound();
  const sp = await searchParams;
  const v = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 8000) : "");
  return (
    <div className="grid max-w-2xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="grid gap-2">
        <Link href="/app/inbox" className="link w-max text-sm text-accent">Inbox</Link>
        <h1 className="page-title">Email a customer</h1>
        <p className="text-muted">Start a conversation yourself: a follow-up after a call, a heads-up about an outage. It becomes a ticket, and their reply lands on it.</p>
      </div>
      <form action={composeTicketAction} encType="multipart/form-data" className="grid gap-4">
        {v("error") && <p role="alert" className="text-warn">{v("error")}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="label">To</span>
            <input name="to" type="email" required defaultValue={v("to")} placeholder="customer@example.com" autoComplete="off" className="field" />
          </label>
          <label className="grid gap-1">
            <span className="label">Their name (optional)</span>
            <input name="name" defaultValue={v("name")} maxLength={100} autoComplete="off" className="field" />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="label">Subject</span>
          <input name="subject" required maxLength={200} defaultValue={v("subject")} className="field" />
        </label>
        <label className="grid gap-1">
          <span className="label">Message</span>
          <textarea name="body" required rows={10} defaultValue={v("body")} className="field" />
        </label>
        <label className="grid gap-1">
          <span className="label">Tags (optional, separated by commas)</span>
          <input name="tags" autoComplete="off" className="field" />
        </label>
        <label className="grid gap-1">
          <span className="label">Attach files (optional)</span>
          <input name="files" type="file" multiple className="text-sm" />
        </label>
        <button className="btn btn-primary w-max">Send email</button>
      </form>
    </div>
  );
}
