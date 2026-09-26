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

import type { FetchLike } from "./http";

// Raw API payloads are untyped JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>;

export type SourceId = "zendesk" | "intercom" | "freshdesk" | "helpscout";
export type Kind = "agent" | "group" | "field" | "tag" | "macro" | "rule" | "contact" | "company" | "ticket";
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
  attachments: { name: string; url: string }[];
};

export type Mapped = { label: string; issues: string[] } & (
  | { kind: "agent"; name: string; email: string | null; role: string; active: boolean }
  | { kind: "group" | "field" | "company" }
  | { kind: "tag"; name: string }
  | { kind: "macro"; name: string; body: string; addTags: string[]; setStatus: Status | null; notApplied: string[]; active: boolean }
  | {
      kind: "rule";
      name: string;
      ruleKind: string;
      active: boolean;
      summary: string[];
      // Set when the rule is exactly "when tagged X, assign to agent Y".
      tagAssign: { tag: string; agentExternalId: string } | null;
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
  // Cheap authenticated call proving the credentials work.
  verify(ctx: Ctx): Promise<void>;
  phases: Phase[];
};

// Helpers shared by adapters.

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export function date(v: unknown, fallback = new Date()): Date {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v); // unix seconds or ms
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? fallback : d;
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

export const ATTACHMENTS_LINKED = "Attachments are linked from the message, not copied into Flatdesk";
