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
    <div className="grid max-w-2xl gap-8 px-4 py-6 md:px-8">
      <h1 className="font-display text-2xl">Settings</h1>
      <section className="grid gap-2">
        <h2 className="font-medium">Email</h2>
        {address ? (
          <>
            <p className="text-muted">
              Forward your support address (for example support@yourcompany.com) to this address. Every email that arrives becomes a
              ticket, and customer replies land on the same ticket.
            </p>
            <p className="num w-max max-w-full select-all break-all rounded-md border border-line bg-surface px-3 py-2">{address}</p>
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
