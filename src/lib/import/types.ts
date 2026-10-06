// Shared shapes for importing from other help desks.
//
// Each source (Zendesk, Intercom, Freshdesk, Help Scout) is an Adapter: a list
// of phases, each of which lists raw records from the source's API and maps
// one raw record to a Flatdesk shape. The engine (engine.ts) stores every raw
// record verbatim in import_records before mapping, so nothing is lost even
// when Flatdesk has no place to show it, and each mapped shape carries
// `issues`: plain sentences saying what couldn't be carried over.
//
// Issue sentences are grouped by exact text in the report, so keep them stable
// (no ids or counts inside); the report lists which records each applies to.

import type { TriggerAction, TriggerCondition, TriggerEvent } from "@/db/schema";
import { noNul } from "@/lib/ids";
import type { FetchLike } from "./http";

// Raw API payloads are untyped JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>;

export type SourceId = "zendesk" | "intercom" | "freshdesk" | "helpscout";
export type Kind = "agent" | "group" | "field" | "tag" | "macro" | "rule" | "contact" | "company" | "ticket" | "section" | "article";
export type Status = "open" | "pending" | "closed";

export type Ctx = {
  source: SourceId;
  creds: Record<string, string>;
  // GET a path (relative to the source's API base) or a full URL on the same host.
  get(pathOrUrl: string): Promise<{ data: Raw; headers: Headers }>;
  // A record stored by an earlier phase of this or a previous import.
  lookup(kind: Kind, externalId: string): Promise<Raw | null>;
  // A sentence about the import as a whole ("Help Scout doesn't share workflow conditions").
  note(text: string): void;
  // Fetches a file. Credentials are sent only to the API's own host; signed
  // links on other hosts (Intercom, Freshdesk storage) are fetched without them.
  download(url: string): Promise<Response>;
};

export type Attachment = {
  name: string;
  // Where the file can be opened in the old help desk; kept in the message if copying fails.
  url: string;
  size?: number | null;
  contentType?: string | null;
  // An API path answering JSON with the file base64-encoded in `data` (Help Scout), used instead of url.
  dataPath?: string | null;
};

export type ListResult = { records: { externalId: string; raw: Raw }[]; next: unknown | null };

export type Msg = {
  externalId: string;
  author: "customer" | "agent" | "system";
  authorExternalId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  internal: boolean;
  createdAt: Date;
  attachments: Attachment[];
};

export type Mapped = { label: string; issues: string[] } & (
  | { kind: "agent"; name: string; email: string | null; role: string; active: boolean }
  | { kind: "group" | "field" | "company" | "section" }
  | {
      kind: "article";
      title: string;
      body: string; // the help center's text format (lib/help.ts), already converted from HTML
      published: boolean;
      section: string | null;
    }
  | { kind: "tag"; name: string }
  | {
      kind: "macro";
      name: string;
      body: string;
      addTags: string[];
      setStatus: Status | null;
      notApplied: string[];
      active: boolean;
      // Only its owner could see it in the old help desk (a personal macro).
      internal?: boolean;
    }
  | {
      kind: "rule";
      name: string;
      ruleKind: string;
      active: boolean;
      summary: string[];
      // Set when the rule is exactly "when tagged X, assign to agent Y".
      tagAssign: { tag: string; agentExternalId: string } | null;
      // Otherwise, set when it can run as a Flatdesk trigger (lib/triggers.ts).
      // An assignee is the old help desk's agent id, matched to a Flatdesk member on import.
      trigger?: { event?: TriggerEvent; hours?: number | null; matchAll: boolean; conditions: TriggerCondition[]; actions: (TriggerAction | { type: "assign_external"; agentExternalId: string })[] } | null;
    }
  | { kind: "contact"; email: string | null; name: string | null; fields: Record<string, string> }
  | {
      kind: "ticket";
      // Set when the record shouldn't become a ticket (deleted, spam); it stays in the archive.
      skip: string | null;
      number: number | null;
      subject: string;
      status: Status;
      channel: "email" | "chat";
      createdAt: Date;
      updatedAt: Date;
      closedAt: Date | null;
      requester: { externalId: string | null; email: string | null; name: string | null };
      assigneeExternalId: string | null;
      tags: string[];
      fields: Record<string, string>;
      messages: Msg[];
    }
);

export type Phase = {
  kind: Kind;
  label: string; // "Macros", shown in progress
  list(ctx: Ctx, cursor: unknown | null): Promise<ListResult>;
  // Second pass for records whose list payload is incomplete (a ticket's full conversation).
  hydrate?(ctx: Ctx, raw: Raw): Promise<Raw>;
  map(raw: Raw, ctx: Ctx): Promise<Mapped> | Mapped;
};

export type CredentialField = { name: string; label: string; placeholder?: string; secret?: boolean };

export type Adapter = {
  id: SourceId;
  name: string; // "Zendesk"
  credentialFields: CredentialField[];
  help: string[]; // where to find the credentials, step by step
  // Validates credentials and returns the account label shown in the app ("acme.zendesk.com").
  account(creds: Record<string, string>): string;
  // Base URL and auth headers for API calls.
  connect(creds: Record<string, string>, fetchImpl?: FetchLike): Promise<{ base: string; headers: Record<string, string> }>;
  // Cheap authenticated call proving the credentials work. Returns the
  // account's key: the source's own id for it (an Intercom workspace id, a
  // Zendesk host), or null when the API has none. Imports from different keys
  // can't share a team. May also return a more exact label than account().
  verify(ctx: Ctx): Promise<{ label?: string; key: string | null }>;
  phases: Phase[];
};

// Helpers shared by adapters.

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

// Dates Postgres can store and people can read: years 1 to 9999.
const MIN_TIME = Date.parse("0001-01-01T00:00:00Z");
const MAX_TIME = Date.parse("9999-12-31T23:59:59Z");
const valid = (d: Date) => Number.isFinite(d.getTime()) && d.getTime() >= MIN_TIME && d.getTime() <= MAX_TIME;

export function date(v: unknown, fallback = new Date()): Date {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return fallback;
    const d = new Date(Math.abs(v) < 1e12 ? v * 1000 : v); // unix seconds or ms
    return valid(d) ? d : fallback;
  }
  if (v instanceof Date) return valid(v) ? v : fallback;
  const d = new Date(str(v));
  return valid(d) ? d : fallback;
}

// Postgres refuses text holding NUL or a lone half of a UTF-16 surrogate
// pair, and old help desks store both. Everything a source returns goes
// through this before it's saved.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function cleanText(s: string): string {
  const t = s.includes("\0") ? noNul(s) : s;
  const wf = (t as string & { toWellFormed?: () => string }).toWellFormed;
  return typeof wf === "function" ? wf.call(t) : t.replace(LONE_SURROGATE, "\uFFFD");
}

// Cuts text to at most n characters without splitting a surrogate pair.
export function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  const code = s.charCodeAt(n - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}

// label -> value, dropping empty values and flattening arrays and objects.
export function fieldMap(entries: [string, unknown][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = Array.isArray(v) ? v.map(str).join(", ") : typeof v === "object" ? JSON.stringify(v) : str(v);
  }
  return out;
}

// Engine issue when a file couldn't be downloaded or is over the size limit.
export const ATTACHMENTS_LINKED = "Some attachments couldn't be copied, so the message links to them in the old help desk instead";
