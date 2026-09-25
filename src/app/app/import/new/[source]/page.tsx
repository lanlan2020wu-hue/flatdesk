import Link from "next/link";
import { notFound } from "next/navigation";
import ImportForm from "@/components/ImportForm";
import { requireAdmin } from "@/lib/auth";
import { ADAPTERS, isSource } from "@/lib/import/engine";

export async function generateMetadata({ params }: PageProps<"/app/import/new/[source]">) {
  const { source } = await params;
  return { title: isSource(source) ? `Import from ${ADAPTERS[source].name}` : "Import" };
}

export default async function NewImportPage({ params }: PageProps<"/app/import/new/[source]">) {
  await requireAdmin();
  const { source } = await params;
  if (!isSource(source)) notFound();
  const a = ADAPTERS[source];

  return (
    <div className="grid max-w-4xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-2">
        <Link href="/app/import" className="link w-max text-sm text-muted">
          All help desks
        </Link>
        <h1 className="font-display text-3xl">Import from {a.name}</h1>
      </header>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <ImportForm
          source={a.id}
          name={a.name}
          fields={a.credentialFields.map((f) => ({ name: f.name, label: f.label, placeholder: f.placeholder, secret: Boolean(f.secret) }))}
        />
        <aside className="grid gap-4 text-sm">
          <section className="grid gap-2">
            <h2 className="eyebrow">Where to find these</h2>
            <ol className="grid list-decimal gap-1.5 pl-5 text-muted">
              {a.help.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          </section>
          <section className="grid gap-2 border-t border-line pt-4">
            <h2 className="eyebrow">What happens</h2>
            <ul className="grid gap-1.5 text-muted">
              <li>Flatdesk only reads from {a.name}. Nothing there is changed or deleted.</li>
              <li>Ticket numbers stay the same where they&apos;re free, and every original field is kept on the ticket.</li>
              <li>Agents are matched by email. Tickets assigned to someone who hasn&apos;t joined yet go to them when they do.</li>
              <li>The key is encrypted while the import runs and erased when it ends.</li>
              <li>You can run it again later to pick up new tickets. Nothing is added twice.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
