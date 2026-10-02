import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { INBOUND_FILE_LIMIT, MAX_FILES, saveAttachments, type NewFile } from "@/lib/attachments";
import { normalizeTags } from "@/lib/tickets";
import { seal, unseal } from "./crypto";
import { claimRule } from "./link";
import { safeDownload, readCapped, type Budget } from "./download";
import { ApiError, CredentialError, makeGetter, RateLimited, type FetchLike } from "./http";
import { freshdesk } from "./sources/freshdesk";
import { helpscout } from "./sources/helpscout";
import { intercom } from "./sources/intercom";
import { zendesk } from "./sources/zendesk";
import { ATTACHMENTS_LINKED, cleanText, cut, type Adapter, type Attachment, type Ctx, type Kind, type Mapped, type Msg, type Phase, type Raw, type SourceId } from "./types";
import { isUuid } from "@/lib/ids";

// Runs imports in short steps so each fits in one serverless request: the
// import page calls runStep() in a loop, and an import resumes where it
// stopped if the page is closed and opened again. Each step either drains
// records waiting for their details (a ticket's conversation), or lists the
// next page of the current phase, or moves to the next phase.

export const ADAPTERS: Record<SourceId, Adapter> = { zendesk, intercom, freshdesk, helpscout };

const { imports, importRecords, externalAgents, importedRules } = schema;
type Job = typeof imports.$inferSelect;
// tries: records being worked on, by external id, with how many steps have
// started on them. listTries: steps that started on the current page.
// pages: pages listed in this phase so far.
type Cursor = { list: unknown | null; listed: boolean; tries?: Record<string, number>; listTries?: number; pages?: number };

const STEP_BUDGET_MS = 20_000;
const HYDRATE_BATCH = 8;
const CONCURRENCY = 4;
// A record whose step died this many times (it hangs, or crashes the
// process) is skipped with an issue, so it can't hold the import up forever.
const MAX_TRIES = 3;
// No source has this many pages of anything; past it, pagination is looping.
const MAX_PAGES_PER_PHASE = 100_000;
// Attachment bytes downloaded per step and per message. A step stops starting
// new records once half its budget is used.
const STEP_BYTES = 200 * 1024 * 1024;
const MESSAGE_BYTES = 40 * 1024 * 1024;
// Imported macros are trimmed to what the macro editor accepts.
const MACRO_NAME_MAX = 200;
const MACRO_BODY_MAX = 8000;

export const GAVE_UP = "Couldn't be imported after several tries; the original is kept in the import archive";

export class ImportError extends Error {}

// Thrown when a save finds the import no longer running (someone cancelled it).
class Stopped extends Error {}

// Postgres unique violation on a given index, through drizzle's error wrapper.
function isUniqueViolation(e: unknown, constraint: string): boolean {
  for (let x = e as { code?: string; constraint?: string; cause?: unknown } | undefined, i = 0; x && i < 3; x = x.cause as typeof x, i++) {
    if (x.code === "23505" && x.constraint === constraint) return true;
  }
  return false;
}

export function isSource(v: unknown): v is SourceId {
  return typeof v === "string" && v in ADAPTERS;
}

async function makeCtx(orgId: string, adapter: Adapter, creds: Record<string, string>, notes: Set<string>, fetchImpl?: FetchLike): Promise<Ctx> {
  const conn = await adapter.connect(creds, fetchImpl);
  const cache = new Map<string, Raw | null>();
  const apiHost = new URL(conn.base).host;
  return {
    source: adapter.id,
    creds,
    get: makeGetter(conn.base, conn.headers, fetchImpl),
    download(url: string) {
      // Checked on every redirect hop: https, a public address, credentials only for the API host.
      return safeDownload(new URL(url, conn.base), (u) => (u.host === apiHost ? conn.headers : {}), fetchImpl);
    },
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
  const RUNNING = "An import is already running. Let it finish or cancel it first.";
  const running = await db.query.imports.findFirst({ where: and(eq(imports.orgId, opts.orgId), eq(imports.status, "running")) });
  if (running) throw new ImportError(RUNNING);

  const notes = new Set<string>();
  let account: string;
  let accountKey: string | null;
  try {
    account = adapter.account(opts.creds);
    const ctx = await makeCtx(opts.orgId, adapter, opts.creds, notes, opts.fetchImpl);
    const verified = await adapter.verify(ctx);
    account = cut(cleanText(verified.label || account), 300);
    accountKey = verified.key ? cut(cleanText(verified.key.trim().toLowerCase()), 300) : null;
  } catch (e) {
    if (e instanceof RateLimited) throw new ImportError(`${adapter.name} is busy. Try again in a minute.`);
    // Our own messages, written for the admin.
    if (e instanceof ApiError || e instanceof CredentialError) throw new ImportError(e.message);
    console.error("import: couldn't connect", adapter.id, e);
    throw new ImportError(`Couldn't connect to ${adapter.name}. Check the details and try again.`);
  }
  // Records are matched by their id in the old help desk, so two Zendesk (or
  // Freshdesk...) accounts in one team would share ids and overwrite each
  // other's tickets. Accounts are compared by key; imports from before keys
  // were kept (or from a source without one) are compared by label.
  const earlier = await db
    .selectDistinct({ account: imports.account, accountKey: imports.accountKey })
    .from(imports)
    .where(and(eq(imports.orgId, opts.orgId), eq(imports.source, opts.source)));
  const other = earlier.find((x) => (x.accountKey && accountKey ? x.accountKey !== accountKey : x.account !== account));
  if (other) {
    throw new ImportError(
      `This team already has an import from ${other.account}. To bring in ${account} too, create a separate team for it, so tickets from the two accounts don't get mixed up.`,
    );
  }

  let credentials: string;
  try {
    credentials = seal(opts.creds);
  } catch (e) {
    console.error("import: couldn't seal credentials", e);
    throw new ImportError("Imports aren't set up on this server yet. Contact support.");
  }
  try {
    const [job] = await db
      .insert(imports)
      .values({
        orgId: opts.orgId,
        source: opts.source,
        account,
        accountKey,
        phase: adapter.phases[0].kind,
        cursor: { list: null, listed: false } satisfies Cursor,
        credentials,
        notes: [...notes],
        startedBy: opts.userId,
      })
      .returning({ id: imports.id });
    return job;
  } catch (e) {
    // Two starts at the same moment both passed the check above; the index lets one through.
    if (isUniqueViolation(e, "imports_org_running")) throw new ImportError(RUNNING);
    throw e;
  }
}

export async function cancelImport(orgId: string, id: string) {
  if (!isUuid(id)) return;
  await db
    .update(imports)
    .set({ status: "cancelled", credentials: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(imports.orgId, orgId), eq(imports.id, id), eq(imports.status, "running")));
}

// Imports only run while their page is open. One left idle for a week is
// cancelled, so its sealed API token doesn't sit in the database. The daily job calls this.
export async function expireIdleImports(days = 7) {
  const rows = await db
    .update(imports)
    .set({ status: "cancelled", credentials: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(imports.status, "running"), lt(imports.updatedAt, new Date(Date.now() - days * 86_400_000))))
    .returning({ id: imports.id });
  return rows.length;
}

// Postgres refuses NUL and lone UTF-16 surrogates in text and jsonb, and one
// in a single record used to stop the whole import on every run. Old help
// desks do store them, so they're cleaned from everything a source returns
// and everything mapped from it.
export function clean<T>(v: T): T {
  if (typeof v === "string") return cleanText(v) as T;
  if (Array.isArray(v)) return v.map(clean) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [cleanText(k), clean(x)])) as T;
  }
  return v;
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
  const bytes: Budget = { left: STEP_BYTES };

  // Saves progress, only while the import still runs: a Cancel clicked during
  // the step stops it at the next save.
  const save = async () => {
    const saved = await db
      .update(imports)
      .set({ phase: adapter.phases[phaseIdx]?.kind ?? job.phase, cursor, counts, notes: [...notes], updatedAt: new Date() })
      .where(and(eq(imports.id, job.id), eq(imports.status, "running")))
      .returning({ id: imports.id });
    if (!saved.length) throw new Stopped();
  };

  try {
    const ctx = await makeCtx(orgId, adapter, unseal(job.credentials!), notes, opts.fetchImpl);
    const deadline = Date.now() + budget;
    while (Date.now() < deadline && bytes.left > STEP_BYTES / 2) {
      const phase = adapter.phases[phaseIdx];
      if (!phase) {
        Object.assign(patch, { status: "done", finishedAt: new Date(), credentials: null });
        break;
      }

      // Records queued for a second pass: a ticket's full conversation, or a
      // page whose step died before its records were saved.
      const waiting = await db
        .select({ externalId: importRecords.externalId, raw: importRecords.raw })
        .from(importRecords)
        .where(and(eq(importRecords.importId, job.id), eq(importRecords.kind, phase.kind), eq(importRecords.pending, true)))
        .orderBy(asc(importRecords.updatedAt), asc(importRecords.externalId))
        .limit(HYDRATE_BATCH);
      if (waiting.length) {
        const tries = { ...cursor.tries };
        // A record retried after its step died runs alone, so one that hangs
        // doesn't take the others down with it.
        const retried = waiting.filter((r) => tries[r.externalId]);
        const batch = retried.length ? [retried[0]] : waiting;
        const run = batch.filter((r) => (tries[r.externalId] ?? 0) < MAX_TRIES);
        for (const r of batch.filter((r) => !run.includes(r))) {
          await giveUp(job, adapter, phase, r.externalId);
          count(phase.kind, "kept");
          delete tries[r.externalId];
        }
        for (const r of run) tries[r.externalId] = (tries[r.externalId] ?? 0) + 1;
        // Saved before the work, so a step that dies still counts as a try.
        cursor = { ...cursor, tries };
        await save();
        try {
          await eachLimit(run, CONCURRENCY, (r) => processRecord(job, adapter, phase, ctx, r.externalId, r.raw as Raw, count, bytes));
        } catch (e) {
          // A rate limit isn't the record's fault.
          if (e instanceof RateLimited) for (const r of run) if (!--tries[r.externalId]) delete tries[r.externalId];
          throw e;
        }
        for (const r of run) delete tries[r.externalId];
        await save();
        continue;
      }

      if (!cursor.listed) {
        const listTries = (cursor.listTries ?? 0) + 1;
        if (listTries > MAX_TRIES) {
          console.error("import: page kept failing", job.id, phase.kind, cursor.list);
          throw new ApiError(0, `Reading ${phase.label.toLowerCase()} from ${adapter.name} kept failing, so the import stopped. Start it again to retry.`);
        }
        cursor = { ...cursor, listTries };
        await save();
        try {
          const listed = await phase.list(ctx, cursor.list);
          // A page listing one record twice would otherwise process it twice at once.
          const unique = new Map<string, Raw>();
          for (const r of listed.records) unique.set(cleanText(r.externalId), clean(r.raw));
          const records = [...unique].map(([externalId, raw]) => ({ externalId, raw }));
          count(phase.kind, "found", records.length);
          // A page retried after its step died queues its records, so they run
          // one at a time and one that hangs is skipped after a few tries.
          const queue = Boolean(phase.hydrate) || listTries > 1;
          if (records.length) {
            // Store every raw record first: the archive is complete even if mapping fails later.
            await db
              .insert(importRecords)
              .values(
                records.map((r) => ({ orgId, source: adapter.id, kind: phase.kind, externalId: r.externalId, importId: job.id, raw: r.raw, pending: queue })),
              )
              .onConflictDoUpdate({
                target: [importRecords.orgId, importRecords.source, importRecords.kind, importRecords.externalId],
                set: { importId: job.id, raw: sql`excluded.raw`, pending: sql`excluded.pending`, updatedAt: new Date() },
              });
            if (!queue) await eachLimit(records, CONCURRENCY, (r) => processRecord(job, adapter, phase, ctx, r.externalId, r.raw, count, bytes));
          }
          const pages = (cursor.pages ?? 0) + 1;
          let next = listed.next ?? null;
          // A source answering with the same page again, or without end, would list forever.
          if (next !== null && (pages >= MAX_PAGES_PER_PHASE || JSON.stringify(next) === JSON.stringify(cursor.list))) {
            console.error("import: pagination stopped", job.id, phase.kind, pages);
            notes.add(`${adapter.name} kept returning more pages of ${phase.label.toLowerCase()}, so Flatdesk stopped reading them. Some may be missing.`);
            next = null;
          }
          cursor = { list: next, listed: next === null, pages, tries: cursor.tries };
        } catch (e) {
          if (e instanceof RateLimited) cursor = { ...cursor, listTries: listTries - 1 };
          throw e;
        }
        await save();
        continue;
      }

      phaseIdx++;
      cursor = { list: null, listed: false };
      await save();
    }
  } catch (e) {
    if (e instanceof Stopped) {
      // Cancelled while the step ran: the update below matches nothing.
    } else if (e instanceof RateLimited) patch.retryAt = e.retryAt;
    else {
      console.error("import step failed", job.id, e);
      Object.assign(patch, {
        status: "failed",
        // Database errors carry the query's values (customer emails, message
        // text), so only the source's own errors are shown on the page.
        error: e instanceof ApiError ? e.message : "Something went wrong on our side. You can start the import again; nothing is added twice.",
        finishedAt: new Date(),
        credentials: null,
      });
    }
  }

  // A Cancel clicked while this step ran wins over whatever the step ended with.
  const [after] = await db
    .update(imports)
    .set({ ...patch, phase: adapter.phases[phaseIdx]?.kind ?? job.phase, cursor, counts, notes: [...notes], lockedUntil: null, updatedAt: new Date() })
    .where(and(eq(imports.id, job.id), eq(imports.status, "running")))
    .returning();
  return after ?? db.query.imports.findFirst({ where: eq(imports.id, job.id) });
}

// A record that kept killing its step: kept in the archive with an issue.
async function giveUp(job: Job, adapter: Adapter, phase: Phase, externalId: string) {
  console.error("import: giving up on record", job.id, adapter.id, phase.kind, externalId);
  await db
    .update(importRecords)
    .set({ pending: false, issues: [GAVE_UP], label: `${phase.kind} ${externalId}`, updatedAt: new Date() })
    .where(
      and(eq(importRecords.orgId, job.orgId), eq(importRecords.source, adapter.id), eq(importRecords.kind, phase.kind), eq(importRecords.externalId, externalId)),
    );
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

async function processRecord(job: Job, adapter: Adapter, phase: Phase, ctx: Ctx, externalId: string, raw: Raw, count: Count, bytes: Budget) {
  const where = and(
    eq(importRecords.orgId, job.orgId),
    eq(importRecords.source, adapter.id),
    eq(importRecords.kind, phase.kind),
    eq(importRecords.externalId, externalId),
  );
  let full = raw;
  let result: { mappedId: string | null; imported: boolean; issues: string[]; label: string };
  try {
    if (phase.hydrate) full = clean(await phase.hydrate(ctx, raw));
    const mapped = clean(await phase.map(full, ctx));
    const prev = await db.query.importRecords.findFirst({ columns: { mappedId: true }, where });
    const written = await write(job, adapter, externalId, mapped, prev?.mappedId ?? null);
    if (written.copy) written.issues.push(...(await copyAttachments(ctx, job.orgId, written.copy, count, bytes)));
    result = { ...written, issues: [...new Set([...mapped.issues, ...written.issues])], label: cut(mapped.label, 300) };
  } catch (e) {
    // A bad token or rate limit stops the step; anything about one record is
    // reported on that record, and the rest of the import carries on.
    if (e instanceof RateLimited || (e instanceof ApiError && (e.status === 401 || e.status === 403))) throw e;
    console.error("import record failed", adapter.id, phase.kind, externalId, e);
    full = { ...full, _importError: cleanText(String((e as Error)?.message ?? e)) };
    result = { mappedId: null, imported: false, issues: ["Couldn't be imported; the original is kept in the import archive"], label: `${phase.kind} ${externalId}` };
  }
  await db
    .update(importRecords)
    .set({ raw: full, label: result.label, mappedId: result.mappedId, issues: result.issues, pending: false, updatedAt: new Date() })
    .where(where);
  count(phase.kind, result.imported ? "imported" : "kept");
}

// copy: messages just added whose files should now be copied into Flatdesk.
type Written = { mappedId: string | null; imported: boolean; issues: string[]; copy?: Copy[] };
type Copy = { ticketId: string; messageId: string; msg: Msg };
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
        ? // Removed agents keep their row but mustn't be handed tickets.
          await db.query.agents.findFirst({
            where: and(eq(schema.agents.orgId, orgId), sql`lower(${schema.agents.email}) = ${email}`, isNull(schema.agents.removedAt)),
          })
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
      const values = {
        name: cut(m.name.trim(), MACRO_NAME_MAX) || "Untitled macro",
        body: cut(m.body, MACRO_BODY_MAX),
        addTags: normalizeTags(m.addTags),
        setStatus: m.setStatus,
        notApplied: m.notApplied,
        // A personal macro in the old help desk: agents can use it, the AI doesn't read it.
        internal: Boolean(m.internal),
      };
      const issues = m.body.length > MACRO_BODY_MAX ? ["Its text was too long for a Flatdesk macro and was shortened; the full text is in the import archive"] : [];
      // One macro per source record, however often the import runs (even two at once).
      const mc = schema.macros;
      const [row] = await db
        .insert(mc)
        .values({ orgId, source: adapter.id, externalId, ...values })
        .onConflictDoUpdate({ target: [mc.orgId, mc.source, mc.externalId], targetWhere: sql`${mc.externalId} is not null`, set: values })
        .returning({ id: mc.id });
      return { mappedId: row.id, imported: true, issues };
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
          // The same tag and agent may already have a rule (made by hand, or by an earlier run).
          const ruleId = await claimRule(orgId, tag, agent.linkedUserId, m.active);
          await db.update(importedRules).set({ flatdeskRuleId: ruleId, pendingTag: null, pendingAssigneeEmail: null }).where(eq(importedRules.id, kept.id));
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

// A message's files are listed with their links first, then copied after the
// message is saved; the list shrinks to whatever couldn't be copied. If a step
// dies halfway, the links are still there.
function withAttachments(m: Msg, files = m.attachments) {
  const body = m.body.trim() || (m.attachments.length ? "" : "(empty message)");
  if (!files.length) return body;
  const list = `${files === m.attachments ? "Attachments" : "Attachments that couldn't be copied"}:\n${files.map((a) => `- ${a.name}${a.url ? `: ${a.url}` : ""}`).join("\n")}`;
  return body ? `${body}\n\n${list}` : list;
}

// budgets: bytes this message and this step may still download. A file that
// doesn't fit stays a link.
async function fetchAttachment(ctx: Ctx, a: Attachment, budgets: Budget[]): Promise<NewFile | null> {
  const room = Math.min(INBOUND_FILE_LIMIT, ...budgets.map((b) => b.left));
  if (a.size && a.size > room) return null;
  try {
    let data: Buffer | null;
    if (a.dataPath) {
      const { data: json } = await ctx.get(a.dataPath);
      data = Buffer.from(String(json.data ?? ""), "base64");
      if (data.length > room) return null;
      for (const b of budgets) b.left -= data.length;
    } else {
      if (!a.url) return null;
      const res = await ctx.download(a.url);
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${res.status}`);
      }
      if (Number(res.headers.get("content-length")) > room) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      // Read in chunks and stop at the limit: the header can be missing or wrong.
      data = await readCapped(res, INBOUND_FILE_LIMIT, budgets);
    }
    if (!data?.length) return null;
    return { filename: cut(a.name, 255) || "attachment", contentType: cut(a.contentType || "application/octet-stream", 255), data };
  } catch (e) {
    // A rate limit or revoked token stops the step like any other call.
    if (e instanceof RateLimited || (e instanceof ApiError && (e.status === 401 || e.status === 403))) throw e;
    console.error("import attachment failed", a.name, e);
    return null;
  }
}

// Time one ticket may spend downloading, so a step stays inside its request.
const COPY_BUDGET_MS = 20_000;

async function copyAttachments(ctx: Ctx, orgId: string, copies: Copy[], count: Count, stepBytes: Budget): Promise<string[]> {
  let missed = false;
  const deadline = Date.now() + COPY_BUDGET_MS;
  for (const { ticketId, messageId, msg } of copies) {
    const files: NewFile[] = [];
    const left: Attachment[] = [];
    const messageBytes: Budget = { left: MESSAGE_BYTES };
    for (const a of msg.attachments) {
      const file = files.length < MAX_FILES && Date.now() < deadline ? await fetchAttachment(ctx, a, [messageBytes, stepBytes]) : null;
      if (file) files.push(file);
      else left.push(a);
    }
    await saveAttachments(orgId, ticketId, messageId, files);
    await db.update(schema.messages).set({ body: withAttachments(msg, left) }).where(eq(schema.messages.id, messageId));
    for (let i = 0; i < files.length; i++) count("file", "imported");
    for (let i = 0; i < left.length; i++) count("file", "kept");
    if (left.length) missed = true;
  }
  return missed ? [ATTACHMENTS_LINKED] : [];
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
    subject: cut(m.subject, 500),
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

  const byExternalId = new Map(m.messages.map((msg) => [msg.externalId, msg]));
  const toCopy = (ticketId: string, added: { id: string; externalId: string | null }[]) =>
    added.flatMap((row) => {
      const msg = row.externalId ? byExternalId.get(row.externalId) : undefined;
      return msg?.attachments.length ? [{ ticketId, messageId: row.id, msg }] : [];
    });

  const t = schema.tickets;
  return db.transaction(async (tx) => {
    // Serialises ticket numbering with live tickets arriving by email.
    const [org] = await tx.select({ next: schema.orgs.nextTicketNumber }).from(schema.orgs).where(eq(schema.orgs.id, orgId)).for("update");

    // Imported before, by this importer (prevMappedId) or by anything else that set the same external id.
    const existing =
      (prevMappedId ? await tx.query.tickets.findFirst({ columns: { id: true, updatedAt: true }, where: and(eq(t.orgId, orgId), eq(t.id, prevMappedId)) }) : null) ??
      (await tx.query.tickets.findFirst({ columns: { id: true, updatedAt: true }, where: and(eq(t.orgId, orgId), eq(t.externalId, ticketValues.externalId)) }));
    if (existing) {
      // Bring it up to date and add only messages not seen yet. Status,
      // assignee and tags follow whichever side changed the ticket last, so a
      // re-import doesn't undo work the team did in Flatdesk since.
      const { subject, channel, customerId, fields, source, externalId, createdAt } = ticketValues;
      const sourceNewer = ticketValues.updatedAt.getTime() > existing.updatedAt.getTime();
      const rest = { subject, channel, customerId, fields, source, externalId, createdAt };
      await tx
        .update(t)
        .set(sourceNewer ? ticketValues : rest)
        .where(eq(t.id, existing.id));
      const have = await tx
        .select({ externalId: schema.messages.externalId, createdAt: schema.messages.createdAt, authorType: schema.messages.authorType })
        .from(schema.messages)
        .where(eq(schema.messages.ticketId, existing.id));
      const seen = new Set(have.map((r) => r.externalId).filter(Boolean));
      // Messages without an id are replies written in Flatdesk, or came from an
      // older import that didn't record ids. Those old ones keep the source's
      // time to the millisecond, so a message matching one by time and author
      // is taken as already there; everything else from the source is new.
      const unnamed = new Set(have.filter((r) => !r.externalId).map((r) => `${r.authorType}:${r.createdAt.getTime()}`));
      const fresh = rows.filter((r) => !seen.has(r.externalId) && !unnamed.has(`${r.authorType}:${r.createdAt.getTime()}`));
      const added = fresh.length
        ? await tx.insert(schema.messages).values(fresh.map((r) => ({ ...r, ticketId: existing.id }))).returning({ id: schema.messages.id, externalId: schema.messages.externalId })
        : [];
      return { mappedId: existing.id, imported: true, issues, copy: toCopy(existing.id, added) };
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
    const added = rows.length
      ? await tx.insert(schema.messages).values(rows.map((r) => ({ ...r, ticketId: ticket.id }))).returning({ id: schema.messages.id, externalId: schema.messages.externalId })
      : [];
    return { mappedId: ticket.id, imported: true, issues, copy: toCopy(ticket.id, added) };
  });
}
