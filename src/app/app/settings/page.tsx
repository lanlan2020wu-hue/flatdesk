import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { emailConfig, inboundAddress } from "@/lib/email";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const s = await requireSession();
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  const address = org ? inboundAddress(org.inboundKey) : null;

  return (
    <div className="grid max-w-2xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <h1 className="font-display text-3xl">Settings</h1>
      <section className="card grid gap-3 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-medium">
          <svg viewBox="0 0 24 24" className="size-8 rounded-lg bg-accent-soft p-1.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>
          Email
        </h2>
        {address ? (
          <>
            <p className="text-muted">
              Forward your support address (for example support@yourcompany.com) to this address. Every email that arrives becomes a
              ticket, and customer replies land on the same ticket.
            </p>
            <p className="num w-max max-w-full select-all break-all rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2 text-sm">{address}</p>
            <p className="text-sm text-muted">
              Replies to customers are sent from {emailConfig.from} under your team&apos;s name, {org?.name}.
            </p>
          </>
        ) : (
          <p className="text-muted">Email isn&apos;t connected on this server yet.</p>
        )}
      </section>
    </div>
  );
}
