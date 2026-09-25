import { createTicketAction } from "../../actions";

export const metadata = { title: "New ticket" };

const field = "rounded-md border border-line bg-surface px-3 py-2";

export default function NewTicketPage() {
  return (
    <div className="grid max-w-2xl gap-5 px-4 py-6 md:px-8">
      <div className="grid gap-1">
        <h1 className="font-display text-2xl">New ticket</h1>
        <p className="text-sm text-muted">Log a request that came in by phone or another channel. Email and chat create tickets automatically.</p>
      </div>
      <form action={createTicketAction} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm" htmlFor="email">Customer email<input id="email" name="email" type="email" required className={field} /></label>
          <label className="grid gap-1 text-sm" htmlFor="name">Customer name<input id="name" name="name" className={field} /></label>
        </div>
        <label className="grid gap-1 text-sm" htmlFor="subject">Subject<input id="subject" name="subject" required className={field} /></label>
        <label className="grid gap-1 text-sm" htmlFor="body">What they asked<textarea id="body" name="body" required rows={6} className={field} /></label>
        <label className="grid gap-1 text-sm" htmlFor="tags">Tags<input id="tags" name="tags" placeholder="billing, refund" className={field} /></label>
        <button className="w-max rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">Create ticket</button>
      </form>
    </div>
  );
}
