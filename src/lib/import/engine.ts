import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeTags } from "@/lib/tickets";
import { seal, unseal } from "./crypto";
import { ApiError, makeGetter, RateLimited, type FetchLike } from "./http";
import { freshdesk } from "./sources/freshdesk";
import { helpscout } from "./sources/helpscout";
import { intercom } from "./sources/intercom";
import { zendesk } from "./sources/zendesk";
import type { Adapter, Ctx, Kind, Mapped, Msg, Phase, Raw, SourceId } from "./types";

// Runs imports in short steps so each fits in one serverless request: the
// import page calls runStep() in a loop, and an import resumes where it
// stopped if the page is closed and opened again. Each step either drains
// records waiting for their details (a ticket's conversation), or lists the
// next page of the current phase, or moves to the next phase.

export const ADAPTERS: Record<SourceId, Adapter> = { zendesk, intercom, freshdesk, helpscout };

const { imports, importRecords, externalAgents, importedRules } = schema;
type Job = typeof imports.$inferSelect;
type Cursor = { list: unknown | null; listed: boolean };

const STEP_BUDGET_MS = 20_000;
const HYDRATE_BATCH = 8;
const CONCURRENCY = 4;

export class ImportError extends Error {}

export function isSource(v: unknown): v is SourceId {
  return typeof v === "string" && v in ADAPTERS;
}

async function makeCtx(orgId: string, adapter: Adapter, creds: Record<string, string>, notes: Set<string>, fetchImpl?: FetchLike): Promise<Ctx> {
  const conn = await adapter.connect(creds, fetchImpl);
  const cache = new Map<string, Raw | null>();
  return {
    source: adapter.id,
    creds,
    get: makeGetter(conn.base, conn.headers, fetchImpl),
    async lookup(kind: Kind, externalId: string) {
      const key = `${kind}:${externalId}`;
      if (!cache.has(key)) {
        const row = await db.query.importRecords.findFirst({
          columns: { raw: true },
          where: and(
            eq(importRecords.orgId, orgId),
            eq(importRecords.source, adapter.id),
            eq(importRecords.kind, kind),
            eq(importRecords.externalId, externalId),
          ),
        });
        cache.set(key, (row?.raw as Raw) ?? null);
      }
      return cache.get(key) ?? null;
    },
    note: (text) => void notes.add(text),
  };
}

export async function startImport(opts: {
  orgId: string;
  userId: string;
  source: SourceId;
  creds: Record<string, string>;
  fetchImpl?: FetchLike;
}): Promise<{ id: string }> {
  const adapter = ADAPTERS[opts.source];
  const running = await db.query.imports.findFirst({ where: and(eq(imports.orgId, opts.orgId), eq(imports.status, "running")) });
  if (running) throw new ImportError("An import is already running. Let it finish or cancel it first.");

  const notes = new Set<string>();
  let account: string;
  try {
    account = adapter.account(opts.creds);
    const ctx = await makeCtx(opts.orgId, adapter, opts.creds, notes, opts.fetchImpl);
    await adapter.verify(ctx);
  } catch (e) {
    if (e instanceof ApiError || e instanceof RateLimited) throw new ImportError(e instanceof RateLimited ? `${adapter.name} is busy. Try again in a minute.` : e.message);
    if (e instanceof Error && !(e instanceof TypeError)) throw new ImportError(e.message);
    throw e;
  }
  const [job] = await db
    .insert(imports)
    .values({
      orgId: opts.orgId,
      source: opts.source,
      account,
      phase: adapter.phases[0].kind,
      cursor: { list: null, listed: false } satisfies Cursor,
      credentials: seal(opts.creds),
      notes: [...notes],
      startedBy: opts.userId,
    })
    .returning({ id: imports.id });
  return job;
}

export async function cancelImport(orgId: string, id: string) {
  await db
    .update(imports)
    .set({ status: "cancelled", credentials: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(imports.orgId, orgId), eq(imports.id, id), eq(imports.status, "running")));
}

// Runs one step. Returns the job as it stands afterwards.
export async function runStep(orgId: string, id: string, opts: { budgetMs?: number; fetchImpl?: FetchLike } = {}): Promise<Job | undefined> {
  const budget = opts.budgetMs ?? STEP_BUDGET_MS;
  const now = new Date();
  // Only one step at a time per import (two open tabs would otherwise race).
  const [job] = await db
    .update(imports)
    .set({ lockedUntil: new Date(now.getTime() + budget + 60_000) })
    .where(
      and(
        eq(imports.orgId, orgId),
        eq(imports.id, id),
        eq(imports.status, "running"),
        or(isNull(imports.lockedUntil), lt(imports.lockedUntil, now)),
        or(isNull(imports.retryAt), lt(imports.retryAt, now)),
      ),
    )
    .returning();
  if (!job) return db.query.imports.findFirst({ where: and(eq(imports.orgId, orgId), eq(imports.id, id)) });

  const adapter = ADAPTERS[job.source];
  const notes = new Set(job.notes);
  const counts = structuredClone(job.counts);
  let phaseIdx = adapter.phases.findIndex((p) => p.kind === job.phase);
  let cursor = (job.cursor as Cursor | null) ?? { list: null, listed: false };
  const patch: Partial<Job> = { retryAt: null };
  const count = (kind: string, key: "found" | "imported" | "kept", n = 1) => {
    counts[kind] ??= { found: 0, imported: 0, kept: 0 };
    counts[kind][key] += n;
  };

  const save = () =>
    db
      .update(imports)
      .set({ phase: adapter.phases[phaseIdx]?.kind ?? job.phase, cursor, counts, notes: [...notes], updatedAt: new Date() })
      .where(eq(imports.id, job.id));

  try {
    const ctx = await makeCtx(orgId, adapter, unseal(job.credentials!), notes, opts.fetchImpl);
    const deadline = Date.now() + budget;
    while (Date.now() < deadline) {
      const phase = adapter.phases[phaseIdx];
      if (!phase) {
        Object.assign(patch, { status: "done", finishedAt: new Date(), credentials: null });
        break;
      }

      if (phase.hydrate) {
        const waiting = await db
          .select({ externalId: importRecords.externalId, raw: importRecords.raw })
          .from(importRecords)
          .where(and(eq(importRecords.importId, job.id), eq(importRecords.kind, phase.kind), eq(importRecords.pending, true)))
          .orderBy(asc(importRecords.updatedAt))
          .limit(HYDRATE_BATCH);
        if (waiting.length) {
          await eachLimit(waiting, CONCURRENCY, (r) => processRecord(job, adapter, phase, ctx, r.externalId, r.raw as Raw, count));
          await save();
          continue;
        }
      }

      if (!cursor.listed) {
        const page = await phase.list(ctx, cursor.list);
        count(phase.kind, "found", page.records.length);
        if (page.records.length) {
          // Store every raw record first: the archive is complete even if mapping fails later.
          await db
            .insert(importRecords)
            .values(
              page.records.map((r) => ({
                orgId,
                source: adapter.id,
                kind: phase.kind,
                externalId: r.externalId,
                importId: job.id,
                raw: r.raw,
                pending: Boolean(phase.hydrate),
              })),
            )
            .onConflictDoUpdate({
              target: [importRecords.orgId, importRecords.source, importRecords.kind, importRecords.externalId],
              set: { importId: job.id, raw: sql`excluded.raw`, pending: sql`excluded.pending`, updatedAt: new Date() },
            });
          if (!phase.hydrate) await eachLimit(page.records, CONCURRENCY, (r) => processRecord(job, adapter, phase, ctx, r.externalId, r.raw, count));
        }
        cursor = { list: page.next, listed: page.next === null };
        await save();
        continue;
      }

      phaseIdx++;
      cursor = { list: null, listed: false };
      await save();
    }
  } catch (e) {
    if (e instanceof RateLimited) patch.retryAt = e.retryAt;
    else {
      console.error("import step failed", job.id, e);
      Object.assign(patch, {
        status: "failed",
        error: e instanceof ApiError ? e.message : `Something went wrong: ${(e as Error).message}`,
        finishedAt: new Date(),
        credentials: null,
      });
    }
  }

  const [after] = await db
    .update(imports)
    .set({ ...patch, phase: adapter.phases[phaseIdx]?.kind ?? job.phase, cursor, counts, notes: [...notes], lockedUntil: null, updatedAt: new Date() })
    .where(eq(imports.id, job.id))
    .returning();
  return after;
}

// Runs fn over items, a few at a time. After a failure no new items start,
// the ones in flight finish, and the first error is thrown.
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  let failed: unknown = null;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length && !failed) {
        try {
          await fn(items[i++]);
        } catch (e) {
          failed ??= e;
        }
      }
    }),
  );
  if (failed) throw failed;
}

type Count = (kind: string, key: "found" | "imported" | "kept") => void;

async function processRecord(job: Job, adapter: Adapter, phase: Phase, ctx: Ctx, externalId: string, raw: Raw, count: Count) {
  const where = and(
    eq(importRecords.orgId, job.orgId),
    eq(importRecords.source, adapter.id),
    eq(importRecords.kind, phase.kind),
    eq(importRecords.externalId, externalId),
  );
  let full = raw;
  let result: { mappedId: string | null; imported: boolean; issues: string[]; label: string };
  try {
    if (phase.hydrate) full = await phase.hydrate(ctx, raw);
    const mapped = await phase.map(full, ctx);
    const prev = await db.query.importRecords.findFirst({ columns: { mappedId: true }, where });
    const written = await write(job, adapter, externalId, mapped, prev?.mappedId ?? null);
    result = { ...written, issues: [...new Set([...mapped.issues, ...written.issues])], label: mapped.label.slice(0, 300) };
  } catch (e) {
    // A bad token or rate limit stops the step; anything about one record is
    // reported on that record, and the rest of the import carries on.
    if (e instanceof RateLimited || (e instanceof ApiError && (e.status === 401 || e.status === 403))) throw e;
    console.error("import record failed", adapter.id, phase.kind, externalId, e);
    full = { ...full, _importError: (e as Error).message };
    result = { mappedId: null, imported: false, issues: ["Couldn't be imported; the original is kept in the import archive"], label: `${phase.kind} ${externalId}` };
  }
  await db
    .update(importRecords)
    .set({ raw: full, label: result.label, mappedId: result.mappedId, issues: result.issues, pending: false, updatedAt: new Date() })
    .where(where);
  count(phase.kind, result.imported ? "imported" : "kept");
}

type Written = { mappedId: string | null; imported: boolean; issues: string[] };
const lower = (v: string | null | undefined) => (v ? v.trim().toLowerCase() : null);
const placeholderEmail = (source: SourceId, id: string) => `${source}-${id.replace(/[^a-zA-Z0-9._-]/g, "")}@no-email.invalid`;
const NO_EMAIL = "Has no email address; kept with a placeholder, so replies to them can't be emailed";

async function write(job: Job, adapter: Adapter, externalId: string, m: Mapped, prevMappedId: string | null): Promise<Written> {
  const orgId = job.orgId;
  switch (m.kind) {
    case "group":
    case "field":
    case "company":
      // No Flatdesk equivalent yet: used to label tickets and contacts, kept in the archive.
      return { mappedId: null, imported: false, issues: [] };

    case "tag": {
      const [name] = normalizeTags([m.name]);
      if (!name) return { mappedId: null, imported: false, issues: ["Empty tag name"] };
      return { mappedId: name, imported: true, issues: name !== m.name ? ["Renamed to Flatdesk's tag format (lowercase, dashes for spaces)"] : [] };
    }

    case "agent": {
      const email = lower(m.email);
      const linked = email
        ? await db.query.agents.findFirst({ where: and(eq(schema.agents.orgId, orgId), sql`lower(${schema.agents.email}) = ${email}`) })
        : null;
      await db
        .insert(externalAgents)
        .values({ orgId, source: adapter.id, externalId, name: m.name, email, role: m.role, active: m.active, linkedUserId: linked?.userId ?? null })
        .onConflictDoUpdate({
          target: [externalAgents.orgId, externalAgents.source, externalAgents.externalId],
          set: { name: m.name, email, role: m.role, active: m.active, ...(linked ? { linkedUserId: linked.userId } : {}) },
        });
      return {
        mappedId: linked?.userId ?? null,
        imported: true,
        issues: email ? [] : ["Has no email address, so they can't be invited or matched to a Flatdesk account"],
      };
    }

    case "macro": {
      if (!m.active) return { mappedId: null, imported: false, issues: [] };
      const values = { name: m.name.slice(0, 200) || "Untitled macro", body: m.body, addTags: normalizeTags(m.addTags), setStatus: m.setStatus, notApplied: m.notApplied, source: adapter.id, externalId };
      if (prevMappedId) {
        const [updated] = await db
          .update(schema.macros)
          .set(values)
          .where(and(eq(schema.macros.orgId, orgId), eq(schema.macros.id, prevMappedId)))
          .returning({ id: schema.macros.id });
        if (updated) return { mappedId: updated.id, imported: true, issues: [] };
      }
      const [row] = await db.insert(schema.macros).values({ orgId, ...values }).returning({ id: schema.macros.id });
      return { mappedId: row.id, imported: true, issues: [] };
    }

    case "rule": {
      const [kept] = await db
        .insert(importedRules)
        .values({ orgId, source: adapter.id, externalId, name: m.name, kind: m.ruleKind, activeInSource: m.active, summary: m.summary })
        .onConflictDoUpdate({
          target: [importedRules.orgId, importedRules.source, importedRules.externalId],
          set: { name: m.name, kind: m.ruleKind, activeInSource: m.active, summary: m.summary },
        })
        .returning();
      if (!m.tagAssign) return { mappedId: kept.id, imported: false, issues: [] };

      const [tag] = normalizeTags([m.tagAssign.tag]);
      const agent = await db.query.externalAgents.findFirst({
        where: and(eq(externalAgents.orgId, orgId), eq(externalAgents.source, adapter.id), eq(externalAgents.externalId, m.tagAssign.agentExternalId)),
      });
      if (agent?.linkedUserId) {
        if (!kept.flatdeskRuleId) {
          const [rule] = await db.insert(schema.rules).values({ orgId, ifTag: tag, assignTo: agent.linkedUserId, enabled: m.active }).returning({ id: schema.rules.id });
          await db.update(importedRules).set({ flatdeskRuleId: rule.id, pendingTag: null, pendingAssigneeEmail: null }).where(eq(importedRules.id, kept.id));
        }
        return { mappedId: kept.id, imported: true, issues: [] };
      }
      if (agent?.email) {
        await db.update(importedRules).set({ pendingTag: tag, pendingAssigneeEmail: agent.email }).where(eq(importedRules.id, kept.id));
        return { mappedId: kept.id, imported: false, issues: ["Will start running when its agent joins Flatdesk"] };
      }
      return { mappedId: kept.id, imported: false, issues: ["Its agent couldn't be matched, so it isn't running"] };
    }

    case "contact": {
      const issues: string[] = [];
      let email = lower(m.email);
      if (!email) {
        email = placeholderEmail(adapter.id, externalId);
        issues.push(NO_EMAIL);
      }
      const id = await upsertCustomer(orgId, email, m.name, m.fields);
      return { mappedId: id, imported: true, issues };
    }

    case "ticket":
      if (m.skip) return { mappedId: null, imported: false, issues: [m.skip] };
      return writeTicket(job, adapter, externalId, m, prevMappedId);
  }
}

async function upsertCustomer(orgId: string, email: string, name: string | null, fields: Record<string, string>) {
  const c = schema.customers;
  const [row] = await db
    .insert(c)
    .values({ orgId, email, name, fields })
    .onConflictDoUpdate({
      target: [c.orgId, c.email],
      set: { name: sql`coalesce(${c.name}, excluded.name)`, fields: sql`${c.fields} || excluded.fields` },
    })
    .returning({ id: c.id });
  return row.id;
}

function withAttachments(m: Msg) {
  const body = m.body.trim() || "(empty message)";
  if (!m.attachments.length) return body;
  return `${body}\n\nAttachments:\n${m.attachments.map((a) => `- ${a.name}${a.url ? `: ${a.url}` : ""}`).join("\n")}`;
}

async function writeTicket(job: Job, adapter: Adapter, externalId: string, m: Extract<Mapped, { kind: "ticket" }>, prevMappedId: string | null): Promise<Written> {
  const orgId = job.orgId;
  const issues: string[] = [];

  // Customer: the contact imported earlier, else one made from the requester.
  let customerId: string | null = null;
  if (m.requester.externalId) {
    const rec = await db.query.importRecords.findFirst({
      columns: { mappedId: true },
      where: and(
        eq(importRecords.orgId, orgId),
        eq(importRecords.source, adapter.id),
        eq(importRecords.kind, "contact"),
        eq(importRecords.externalId, m.requester.externalId),
      ),
    });
    customerId = rec?.mappedId ?? null;
  }
  if (!customerId) {
    let email = lower(m.requester.email);
    if (!email) {
      email = placeholderEmail(adapter.id, m.requester.externalId ?? `ticket-${externalId}`);
      issues.push("Its customer has no email address; replies can't be emailed");
    }
    customerId = await upsertCustomer(orgId, email, m.requester.name, {});
  }
  const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, customerId) });

  // Agents from the old help desk, keyed by their id there.
  const agentIds = [...new Set([m.assigneeExternalId, ...m.messages.filter((x) => x.author === "agent").map((x) => x.authorExternalId)].filter((x): x is string => Boolean(x)))];
  const agents = new Map(
    agentIds.length
      ? (
          await db
            .select()
            .from(externalAgents)
            .where(and(eq(externalAgents.orgId, orgId), eq(externalAgents.source, adapter.id), inArray(externalAgents.externalId, agentIds)))
        ).map((a) => [a.externalId, a])
      : [],
  );

  const fields: Record<string, string> = { [`Imported from`]: `${adapter.name} ${m.number ? `#${m.number}` : externalId}`, ...m.fields };
  const cleaned = [...new Set(m.tags.map((t) => t.trim()).filter(Boolean))];
  const tags = normalizeTags(cleaned);
  if (cleaned.length > 20) issues.push("Had more than 20 tags; all of them are kept in the Original tags field");
  if (cleaned.length > 20 || cleaned.some((t) => !tags.includes(t))) fields["Original tags"] = cleaned.join(", ");
  if (cleaned.slice(0, 20).some((t) => !tags.includes(t))) issues.push("Tag names were changed to Flatdesk's format; the originals are kept in the Original tags field");

  let assigneeId: string | null = null;
  let pendingAssigneeEmail: string | null = null;
  if (m.assigneeExternalId) {
    const a = agents.get(m.assigneeExternalId);
    assigneeId = a?.linkedUserId ?? null;
    if (!assigneeId) {
      pendingAssigneeEmail = a?.email ?? null;
      fields[`Assignee in ${adapter.name}`] = a ? `${a.name}${a.email ? ` <${a.email}>` : ""}` : `#${m.assigneeExternalId}`;
      if (!a) issues.push("Its assignee wasn't found among the old help desk's agents");
    }
  }

  const rows = m.messages.map((msg) => {
    const agent = msg.author === "agent" && msg.authorExternalId ? agents.get(msg.authorExternalId) : undefined;
    const email = lower(agent?.email ?? msg.authorEmail);
    const isRequester =
      msg.author === "customer" && ((msg.authorExternalId && msg.authorExternalId === m.requester.externalId) || (email && email === customer?.email));
    return {
      orgId,
      authorType: msg.author,
      authorId: msg.author === "agent" ? (agent?.linkedUserId ?? null) : isRequester ? customerId : null,
      authorName: agent?.name ?? msg.authorName,
      authorEmail: email,
      externalId: msg.externalId,
      body: withAttachments(msg),
      internal: msg.internal,
      createdAt: msg.createdAt,
    };
  });
  const firstResponse = m.messages.filter((x) => x.author === "agent" && !x.internal).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const ticketValues = {
    subject: m.subject.slice(0, 500),
    status: m.status,
    channel: m.channel,
    customerId,
    assigneeId,
    pendingAssigneeEmail,
    tags,
    fields,
    source: adapter.id,
    externalId: `${adapter.id}:${externalId}`,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    closedAt: m.closedAt,
    firstResponseAt: firstResponse?.createdAt ?? null,
  };

  const t = schema.tickets;
  return db.transaction(async (tx) => {
    // Serialises ticket numbering with live tickets arriving by email.
    const [org] = await tx.select({ next: schema.orgs.nextTicketNumber }).from(schema.orgs).where(eq(schema.orgs.id, orgId)).for("update");

    // Imported before, by this importer (prevMappedId) or by anything else that set the same external id.
    const existing =
      (prevMappedId ? await tx.query.tickets.findFirst({ columns: { id: true }, where: and(eq(t.orgId, orgId), eq(t.id, prevMappedId)) }) : null) ??
      (await tx.query.tickets.findFirst({ columns: { id: true }, where: and(eq(t.orgId, orgId), eq(t.externalId, ticketValues.externalId)) }));
    if (existing) {
      // Bring it up to date and add only messages not seen yet.
      await tx.update(t).set(ticketValues).where(eq(t.id, existing.id));
      const ids = (await tx.select({ id: schema.messages.externalId }).from(schema.messages).where(eq(schema.messages.ticketId, existing.id))).map((r) => r.id);
      const seen = new Set(ids);
      // Messages without ids came from an older import that didn't record them; don't guess which are new.
      const fresh = ids.includes(null) ? [] : rows.filter((r) => !seen.has(r.externalId));
      if (fresh.length) await tx.insert(schema.messages).values(fresh.map((r) => ({ ...r, ticketId: existing.id })));
      return { mappedId: existing.id, imported: true, issues };
    }

    // Keep the old ticket number when it's free, so "#4521" still means the same ticket.
    let number = m.number;
    if (number) {
      const taken = await tx.query.tickets.findFirst({ columns: { id: true }, where: and(eq(t.orgId, orgId), eq(t.number, number)) });
      if (taken) {
        issues.push("Its original number was already used in Flatdesk, so it has a new number");
        number = null;
      }
    }
    number ??= org.next;
    await tx
      .update(schema.orgs)
      .set({ nextTicketNumber: sql`greatest(${schema.orgs.nextTicketNumber}, ${number + 1})` })
      .where(eq(schema.orgs.id, orgId));
    const [ticket] = await tx.insert(t).values({ orgId, number, ...ticketValues }).returning({ id: t.id });
    if (rows.length) await tx.insert(schema.messages).values(rows.map((r) => ({ ...r, ticketId: ticket.id })));
    return { mappedId: ticket.id, imported: true, issues };
  });
}
