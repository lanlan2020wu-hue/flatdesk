import TagInput from "@/components/TagInput";
import { requireOpenPage } from "@/lib/auth";
import { orgTags } from "@/lib/tickets";
import { createTicketAction } from "../../actions";

export const metadata = { title: "New ticket" };

const field = "field font-normal";

export default async function NewTicketPage() {
  const s = await requireOpenPage();
  const tags = await orgTags(s.orgId);
  return (
    <div className="grid max-w-2xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="grid gap-1">
        <h1 className="page-title">New ticket</h1>
        <p className="text-sm text-muted">Log a request that came in by phone or another channel. Email and chat create tickets automatically.</p>
      </div>
      <form action={createTicketAction} className="card grid gap-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="email">Customer email<input id="email" name="email" type="email" required className={field} /></label>
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="name">Customer name<input id="name" name="name" className={field} /></label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="subject">Subject<input id="subject" name="subject" required className={field} /></label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="body">What they asked<textarea id="body" name="body" required rows={6} className={field} /></label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="tags">Tags<TagInput tags={tags} id="tags" name="tags" placeholder="billing, refund" className={field} /></label>
        <button className="btn btn-primary w-max">Create ticket</button>
      </form>
    </div>
  );
}
