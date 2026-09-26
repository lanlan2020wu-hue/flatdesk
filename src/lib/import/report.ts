import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ADAPTERS } from "./engine";
import type { Kind } from "./types";

const { imports, importRecords } = schema;

export const KIND_LABEL: Record<Kind, string> = {
  agent: "Agents",
  group: "Groups and inboxes",
  field: "Custom fields",
  tag: "Tags",
  macro: "Macros and saved replies",
  rule: "Rules",
  company: "Companies",
  contact: "Contacts",
  ticket: "Tickets",
};

export const IMPORT_STATUS: Record<string, { label: string; tone: string }> = {
  running: { label: "Running", tone: "text-accent" },
  done: { label: "Finished", tone: "text-accent" },
  failed: { label: "Stopped", tone: "text-warn" },
  cancelled: { label: "Cancelled", tone: "text-muted" },
};

export async function listImports(orgId: string) {
  return db.select().from(imports).where(eq(imports.orgId, orgId)).orderBy(desc(imports.createdAt)).limit(20);
}

export async function getImport(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.query.imports.findFirst({ where: and(eq(imports.orgId, orgId), eq(imports.id, id)) })) ?? null;
}

// What happened in an import: counts per kind, and every issue grouped by its
// sentence with a few example records.
export async function importReport(orgId: string, id: string) {
  const job = await getImport(orgId, id);
  if (!job) throw new Error("Import not found.");
  const rows = await db.execute<{ kind: Kind; issue: string; count: number; examples: string[] }>(sql`
    select kind, issue, count(*)::int as count,
           (array_agg(coalesce(nullif(${importRecords.label}, ''), ${importRecords.externalId}) order by ${importRecords.externalId}))[1:5] as examples
    from ${importRecords}, unnest(${importRecords.issues}) as issue
    where ${importRecords.orgId} = ${orgId} and ${importRecords.importId} = ${id}
    group by kind, issue
    order by count(*) desc
  `);
  const adapter = ADAPTERS[job.source];
  const phases = adapter.phases.map((p) => ({ kind: p.kind, label: p.label }));
  return { job, adapter: { id: adapter.id, name: adapter.name }, phases, counts: job.counts, issues: rows.rows };
}

// Every record with at least one issue, for the CSV download.
export async function issueRows(orgId: string, id: string) {
  return db
    .select({
      kind: importRecords.kind,
      externalId: importRecords.externalId,
      label: importRecords.label,
      mappedId: importRecords.mappedId,
      issues: importRecords.issues,
    })
    .from(importRecords)
    .where(and(eq(importRecords.orgId, orgId), eq(importRecords.importId, id), sql`cardinality(${importRecords.issues}) > 0`))
    .orderBy(importRecords.kind, importRecords.externalId);
}
