import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { AUDIT_LABELS, AUDIT_PAGE, auditLog, type AuditAction } from "@/lib/security";

export const metadata = { title: "Audit log" };

// Who changed what, newest first. Admins only. The full log is also in the archive export.
export default async function AuditPage({ searchParams }: PageProps<"/app/settings/audit">) {
  const s = await requireSession();
  if (s.role !== "admin") notFound();
  const { before } = await searchParams;
  const since = typeof before === "string" && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;
  const rows = await auditLog(s.orgId, since);
  const when = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="grid gap-2">
        <Link href="/app/settings#security" className="link w-max text-sm text-accent">Settings</Link>
        <h1 className="page-title">Audit log</h1>
        <p className="text-muted">
          Changes to settings, seats, integrations and API keys, exports, imports, AI answer refunds, deleted macros, and people joining. Kept as long as your account. It&apos;s also in the full archive download.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted">Nothing yet.</p>
      ) : (
        <ol className="grid divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <span className="num text-sm text-muted">{when(r.createdAt)}</span>
              <span className="grid gap-0.5">
                <span>
                  <span className="font-medium">{r.actorName}</span> · {AUDIT_LABELS[r.action as AuditAction] ?? r.action}
                </span>
                {r.detail && <span className="text-sm break-words text-muted">{r.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {rows.length === AUDIT_PAGE && (
        <Link href={`/app/settings/audit?before=${encodeURIComponent(rows[rows.length - 1].createdAt.toISOString())}`} className="link w-max text-accent">
          Older entries
        </Link>
      )}
    </div>
  );
}
