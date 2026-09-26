import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { ADAPTERS } from "@/lib/import/engine";
import { IMPORT_STATUS, listImports } from "@/lib/import/report";

export const metadata = { title: "Import" };


const WHAT: Record<string, string> = {
  zendesk: "Tickets (archived ones too), macros, triggers and automations, tags, custom fields, users and organizations",
  intercom: "Conversations with every reply and note, macros, tags, contacts, companies and teammates",
  freshdesk: "Tickets with conversations, canned responses, scenarios, automation rules, contacts, companies and agents",
  helpscout: "Conversations with every thread, saved replies, workflows, tags, custom fields, customers and users",
};

export default async function ImportPage() {
  const s = await requireSession();
  const past = await listImports(s.orgId);

  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-2">
        <p className="eyebrow">Workspace</p>
        <h1 className="font-display text-3xl">Bring your help desk with you</h1>
        <p className="text-muted">
          Flatdesk copies everything it can read and keeps the original of every record, so nothing is dropped. Anything that doesn&apos;t
          have a place in Flatdesk yet is listed in a report instead of disappearing. Your old help desk isn&apos;t changed.
        </p>
      </header>

      {s.role !== "admin" ? (
        <p className="card p-5 text-muted">Ask an admin on your team to run the import.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {Object.values(ADAPTERS).map((a) => (
            <li key={a.id}>
              <Link href={`/app/import/new/${a.id}`} className="card group grid h-full gap-2 p-5 transition-shadow hover:shadow-md">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.name}</span>
                  <span aria-hidden="true" className="text-muted transition-transform group-hover:translate-x-0.5">→</span>
                </span>
                <span className="text-sm text-muted">{WHAT[a.id]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <section className="grid gap-3">
          <h2 className="eyebrow">Past imports</h2>
          <ul className="card divide-y divide-line">
            {past.map((j) => {
              const tickets = j.counts.ticket;
              return (
                <li key={j.id}>
                  <Link href={`/app/import/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-surface-2">
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {ADAPTERS[j.source].name} · {j.account}
                      </span>
                      <span className="text-muted">
                        Started {timeAgo(j.createdAt)}
                        {tickets ? ` · ${tickets.imported} tickets` : ""}
                      </span>
                    </span>
                    <span className={`pill ${IMPORT_STATUS[j.status].tone}`}>{IMPORT_STATUS[j.status].label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
