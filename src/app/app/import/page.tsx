import { requireSession } from "@/lib/auth";
import { importZendeskAction } from "../actions";
import SubmitButton from "@/components/SubmitButton";

export const metadata = { title: "Import" };
// The import runs inside the form submission.
export const maxDuration = 300;

export default async function ImportPage({ searchParams }: PageProps<"/app/import">) {
  const s = await requireSession();
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  const imported = one("imported");
  const error = one("error");

  return (
    <div className="grid max-w-2xl gap-6 px-4 py-6 md:px-8">
      <div className="grid gap-2">
        <h1 className="font-display text-2xl">Import from Zendesk</h1>
        <p className="text-muted">
          Brings over your Zendesk tickets with every reply and internal note, their status, tags and dates. Nothing is sent to your
          customers, and the AI leaves imported tickets alone.
        </p>
      </div>

      {error && <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">{error}</p>}
      {imported !== undefined && (
        <p className="rounded-md bg-accent-soft px-3 py-2 text-sm" role="status">
          {imported === "0"
            ? "No new tickets to import."
            : `Imported ${imported} tickets with ${one("messages")} messages.`}{" "}
          {Number(one("skipped")) > 0 && `Skipped ${one("skipped")} that were already here or deleted in Zendesk. `}
          {one("more") ? "There are more tickets left. Run the import again to continue where it stopped." : "That's everything."}
        </p>
      )}

      {s.role !== "admin" ? (
        <p className="text-muted">Only admins can import.</p>
      ) : (
        <form action={importZendeskAction} className="grid gap-4">
          <label className="grid gap-1">
            <span>Zendesk subdomain</span>
            <span className="flex items-center gap-1">
              <input name="subdomain" required placeholder="yourcompany" autoComplete="off" className="w-48 rounded-md border border-line bg-surface px-3 py-2" />
              <span className="text-muted">.zendesk.com</span>
            </span>
          </label>
          <label className="grid gap-1">
            <span>Zendesk admin email</span>
            <input name="email" type="email" required autoComplete="off" className="rounded-md border border-line bg-surface px-3 py-2" />
          </label>
          <label className="grid gap-1">
            <span>API token</span>
            <span className="text-sm text-muted">
              In Zendesk, go to Admin Center, Apps and integrations, Zendesk API, and add a token. We use it for this import only and
              don&apos;t store it. Delete it in Zendesk when you&apos;re done.
            </span>
            <input name="token" type="password" required autoComplete="off" className="rounded-md border border-line bg-surface px-3 py-2" />
          </label>
          <SubmitButton pending="Importing, this can take a few minutes…">Import tickets</SubmitButton>
          <p className="text-sm text-muted">
            Large accounts import in parts of a few minutes each. Running it again skips tickets already imported. Attachments aren&apos;t
            copied yet.
          </p>
        </form>
      )}
    </div>
  );
}
