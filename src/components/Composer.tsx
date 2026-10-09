"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync, useFormStatus } from "react-dom";
import { copilotDraftAction, copilotRewriteAction, copilotTranslateAction } from "@/app/app/actions";
import { CopilotMark } from "@/components/CopilotSummary";
import { REWRITE_LABEL, type RewriteStyle } from "@/lib/copilot-config";

// Mirrors REPLY_UPLOAD_LIMIT and MAX_FILES in lib/attachments.ts (Vercel caps request bodies at 4.5 MB).
const UPLOAD_LIMIT = 4 * 1024 * 1024;
const MAX_FILES = 10;

type Macro = { id: string; name: string; body: string; addTags: string[]; setStatus: string | null; assignTo: string | null; sendNow: boolean };

const NAME_PLACEHOLDER = /\[(customer(?:'s)? (?:first )?name|first name|name)\]/gi;
const STATUS_WORD: Record<string, string> = { open: "open", pending: "pending", closed: "closed" };

// Unsent replies and notes are kept in this browser as they're typed, so a
// closed tab, a refresh or a new message landing on the ticket doesn't lose them.
const DRAFT_PREFIX = "flatdesk:draft:";
const DRAFT_DAYS = 14;
type Draft = { body: string; internal: boolean; at: number };

function readDraft(key: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) ?? "null") as Draft | null;
    return d && typeof d.body === "string" && d.body.trim() ? d : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, d: Draft | null) {
  try {
    if (d && d.body.trim()) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // storage full or blocked; the reply box still works
  }
}

// Drafts nobody came back to.
function dropOldDrafts() {
  try {
    const cutoff = Date.now() - DRAFT_DAYS * 86_400_000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(DRAFT_PREFIX)) continue;
      const d = JSON.parse(localStorage.getItem(k) ?? "null") as Draft | null;
      if (!d || !(d.at > cutoff)) localStorage.removeItem(k);
    }
  } catch {
    // nothing to tidy
  }
}

function SendButton({ internal }: { internal: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn btn-primary btn-sm">
      {pending ? "Saving…" : internal ? "Add note" : "Send reply"}
    </button>
  );
}

export default function Composer({
  action,
  ticketId,
  number,
  status,
  macros,
  suggestedMacroId = null,
  copilot = true,
  customerName = null,
  agents = [],
  customerLanguage = null,
  draftKey = null,
}: {
  action: (f: FormData) => Promise<void>;
  ticketId: string;
  number: number;
  status: string;
  macros: Macro[];
  // The macro Flatdesk identified as the answer to the customer's latest message.
  suggestedMacroId?: string | null;
  copilot?: boolean;
  customerName?: string | null;
  agents?: { userId: string; name: string }[];
  // The customer writes in another language than the team: replies can be translated into it.
  customerLanguage?: { code: string; label: string } | null;
  // Where this person's unsent draft for this ticket is kept, e.g. "<userId>:<ticketId>".
  draftKey?: string | null;
}) {
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const [addTags, setAddTags] = useState("");
  // Replies default to "pending" (waiting on the customer); notes keep the current status.
  const [statusChoice, setStatusChoice] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextStatus = statusChoice ?? (internal ? status : "pending");
  const formRef = useRef<HTMLFormElement>(null);
  const [thinking, startCopilot] = useTransition();
  const [working, setWorking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [usedSuggestion, setUsedSuggestion] = useState(false);
  // What the agent wrote before translating it for the customer.
  const [original, setOriginal] = useState<string | null>(null);
  // Macros inserted into this reply, so the server can learn how the team edits them.
  const [macroIds, setMacroIds] = useState<string[]>([]);
  // What the inserted macro will do when the reply is sent.
  const [assignTo, setAssignTo] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);

  // From the Attach button, a pasted screenshot, or files dropped on the reply box.
  function addFiles(added: File[]) {
    if (!added.length) return;
    const picked = [...files, ...added];
    const total = picked.reduce((n, f) => n + f.size, 0);
    if (picked.length > MAX_FILES) return setError(`Attach up to ${MAX_FILES} files per reply.`);
    if (total > UPLOAD_LIMIT) return setError("Attachments on one reply can add up to 4 MB. Share bigger files as a link.");
    setError(null);
    setFiles(picked);
  }
  const [restored, setRestored] = useState(false);
  const draftReady = useRef(false);

  // Bring back an unsent draft once the page is in the browser (after
  // hydration, since the server can't see localStorage).
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      dropOldDrafts();
      const d = readDraft(draftKey);
      if (d) {
        setBody((b) => b || d.body);
        setInternal(d.internal);
        setRestored(true);
      }
      draftReady.current = true;
    });
    return () => clearTimeout(t);
  }, [draftKey]);

  // Saved on every change, so nothing is lost if the box goes away mid-sentence.
  useEffect(() => {
    if (!draftKey || !draftReady.current) return;
    writeDraft(draftKey, { body, internal, at: Date.now() });
  }, [draftKey, body, internal]);

  // Keyboard shortcuts (components/Shortcuts.tsx): r to reply, n for a note.
  useEffect(() => {
    const onCompose = (e: Event) => {
      setInternal((e as CustomEvent<string>).detail === "note");
      textRef.current?.focus();
    };
    window.addEventListener("flatdesk:compose", onCompose);
    return () => window.removeEventListener("flatdesk:compose", onCompose);
  }, []);

  const suggested = !usedSuggestion && suggestedMacroId ? macros.find((m) => m.id === suggestedMacroId) : undefined;

  function draft() {
    setWorking("Drafting a reply…");
    startCopilot(async () => {
      setError(null);
      setNote(null);
      const r = await copilotDraftAction(ticketId);
      setWorking(null);
      if (!r.ok) return setError(r.error);
      setInternal(false);
      setBody(r.value.reply);
      if (r.value.gaps) setNote(r.value.gaps);
    });
  }

  function rewrite(style: RewriteStyle) {
    if (!body.trim()) return setError("Write something first, then the copilot can rewrite it.");
    setWorking(`${REWRITE_LABEL[style]}…`);
    startCopilot(async () => {
      setError(null);
      const r = await copilotRewriteAction(ticketId, body, style);
      setWorking(null);
      if (!r.ok) return setError(r.error);
      setBody(r.value);
    });
  }

  function translate() {
    if (!customerLanguage || !body.trim()) return;
    setWorking(`Translating to ${customerLanguage.label}…`);
    startCopilot(async () => {
      setError(null);
      const r = await copilotTranslateAction(ticketId, body, customerLanguage.code);
      setWorking(null);
      if (!r.ok) return setError(r.error);
      setOriginal(original ?? body);
      setBody(r.value);
      setNote(`This is your reply in ${customerLanguage.label}. Edit it if you like. Your team sees what you wrote beside it.`);
    });
  }

  function applyMacro(id: string) {
    const m = macros.find((x) => x.id === id);
    if (!m) return;
    const first = customerName?.trim().split(/\s+/)[0];
    const text = first ? m.body.replace(NAME_PLACEHOLDER, first) : m.body;
    const next = body ? `${body}\n\n${text}` : text;
    // Committed synchronously so a send-right-away macro submits the filled-in form.
    flushSync(() => {
      setBody(next);
      setAddTags(m.addTags.join(", "));
      if (m.setStatus) setStatusChoice(m.setStatus);
      if (m.assignTo) setAssignTo(m.assignTo);
      setMacroIds((ids) => [...ids, id]);
    });
    const who = m.assignTo ? agents.find((a) => a.userId === m.assignTo)?.name : null;
    setActions([
      ...(who ? [`assign to ${who}`] : []),
      ...(m.setStatus ? [`set ${STATUS_WORD[m.setStatus] ?? m.setStatus}`] : []),
      ...(m.addTags.length ? [`tag ${m.addTags.join(", ")}`] : []),
    ]);
    // A macro set to send right away goes out now, unless it still has blanks to fill.
    const blanks = next.match(/\[[^\]\n]{1,40}\]/g);
    if (m.sendNow && !internal) {
      if (blanks) setNote(`Fill in ${[...new Set(blanks)].join(", ")}, then send. This macro sends right away once it has no blanks.`);
      else formRef.current?.requestSubmit();
    }
    if (id === suggestedMacroId) setUsedSuggestion(true);
  }

  return (
    <form
      ref={formRef}
      action={async (f) => {
        f.delete("files");
        for (const file of files) f.append("files", file);
        if (!f.get("body")?.toString().trim() && files.length === 0) return setError("Write a reply or attach a file first.");
        setError(null);
        // The page may move on as soon as it's sent, so the draft goes first.
        draftReady.current = false;
        if (draftKey) writeDraft(draftKey, null);
        try {
          await action(f);
        } catch {
          draftReady.current = true;
          if (draftKey) writeDraft(draftKey, { body: f.get("body")?.toString() ?? "", internal, at: Date.now() });
          return setError("That didn't save. Check your connection and try again; your text is still here.");
        }
        setRestored(false);
        draftReady.current = true;
        setBody("");
        setOriginal(null);
        setNote(null);
        setAddTags("");
        setStatusChoice(null);
        setFiles([]);
        setMacroIds([]);
        setAssignTo("");
        setActions([]);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
      className={`grid gap-3 rounded-[8px] border p-3 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-accent/25 ${internal ? "border-warn/50 bg-warn-soft" : "border-line bg-surface"} ${dragging ? "ring-2 ring-accent/50" : ""}`}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="addTags" value={addTags} />
      <input type="hidden" name="macroIds" value={macroIds.join(",")} />
      <input type="hidden" name="assignTo" value={assignTo} />
      {original && !internal && <input type="hidden" name="original" value={original} />}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="radiogroup" aria-label="Message type" className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          <button type="button" role="radio" aria-checked={!internal} onClick={() => setInternal(false)} className={`rounded-md px-3 py-1 transition-colors ${!internal ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}>Reply</button>
          <button type="button" role="radio" aria-checked={internal} title="Only your team sees internal notes" onClick={() => setInternal(true)} className={`rounded-md px-3 py-1 transition-colors ${internal ? "bg-surface font-medium text-warn shadow-sm" : "text-muted hover:text-ink"}`}>Internal note</button>
        </div>
        {internal && <input type="hidden" name="internal" value="on" />}
        {macros.length > 0 && (
          <select aria-label="Insert macro" className="field field-sm w-auto" value="" onChange={(e) => applyMacro(e.target.value)}>
            <option value="">Insert saved reply (macro)…</option>
            {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {/* One copilot control at a time: draft into an empty box, rewrite what's there. */}
        {copilot && (
          <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {body.trim() && customerLanguage && !internal && !original && (
              <button type="button" onClick={translate} disabled={thinking} className="btn btn-secondary btn-sm text-accent">
                <CopilotMark />
                Translate to {customerLanguage.label}
              </button>
            )}
            {body.trim() ? (
              <select
                aria-label="Rewrite with the copilot"
                className="field field-sm w-auto"
                value=""
                disabled={thinking}
                onChange={(e) => e.target.value && rewrite(e.target.value as RewriteStyle)}
              >
                <option value="">Rewrite…</option>
                {(Object.keys(REWRITE_LABEL) as RewriteStyle[]).map((k) => <option key={k} value={k}>{REWRITE_LABEL[k]}</option>)}
              </select>
            ) : (
              <button type="button" onClick={draft} disabled={thinking} className="btn btn-secondary btn-sm text-accent">
                <CopilotMark />
                Draft reply
              </button>
            )}
          </span>
        )}
      </div>
      {suggested && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
          <CopilotMark className="size-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            The customer seems to be asking what your <strong className="font-medium">{suggested.name}</strong> macro answers.{" "}
            {suggested.sendNow ? "Using it sends the reply right away, unless it has blanks to fill." : "Use it to fill in the reply, then check it and send."}
          </span>
          <button type="button" onClick={() => applyMacro(suggested.id)} className="btn btn-secondary btn-sm">Use macro</button>
          <button type="button" onClick={() => setUsedSuggestion(true)} className="link px-1 text-muted">Dismiss</button>
        </p>
      )}
      <label htmlFor="composer" className="sr-only">{internal ? "Internal note" : "Reply"}</label>
      {restored && body.trim() && (
        <p className="flex flex-wrap items-center gap-2 px-2 text-sm text-muted" role="status">
          Your unsent {internal ? "note" : "reply"} is back.
          <button
            type="button"
            className="link text-muted"
            onClick={() => {
              setBody("");
              setRestored(false);
              textRef.current?.focus();
            }}
          >
            Discard it
          </button>
        </p>
      )}
      <textarea
        ref={textRef}
        id="composer"
        name="body"
        rows={6}
        value={body}
        readOnly={thinking}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(e) => {
          // A screenshot on the clipboard becomes an attachment; text pastes as usual.
          const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
          if (!images.length) return;
          e.preventDefault();
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          addFiles(images.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${stamp}${i ? `-${i + 1}` : ""}.${f.type.split("/")[1] || "png"}`, { type: f.type }))));
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") formRef.current?.requestSubmit();
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        placeholder={internal ? "Only your team sees this. Type @ and a name to email a teammate." : "Write your reply… Paste a screenshot or drop files here to attach them."}
        className="w-full resize-y rounded-lg bg-transparent px-2 py-1 focus:outline-none"
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-2 text-sm" aria-label="Files to attach">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-64 items-center gap-1.5 rounded-lg border border-line bg-bg py-1 pr-1 pl-2.5">
              <span className="truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} className="rounded px-1.5 text-muted hover:bg-surface-2 hover:text-ink">×</button>
            </li>
          ))}
        </ul>
      )}
      {working && <p className="flex items-center gap-2 px-2 text-sm text-accent" role="status"><CopilotMark className="size-4 animate-pulse" />{working}</p>}
      {note && <p className="px-2 text-sm text-muted">Check before sending: {note}</p>}
      {error && <p className="px-2 text-sm text-warn" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm">
        <span className="flex flex-wrap items-center gap-3 text-muted">
          <label className="btn btn-secondary btn-sm cursor-pointer">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M13.5 6.5 7.8 12.2a1.6 1.6 0 1 0 2.3 2.3l6-6a3.2 3.2 0 0 0-4.5-4.5l-6 6a4.8 4.8 0 0 0 6.8 6.8l5-5" /></svg>
            Attach
            <input
              ref={fileRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
          {actions.length > 0 ? <span className="text-accent">On send: {actions.join(", ")}</span> : addTags && <span>Adds tags: {addTags}</span>}
        </span>
        <div className="flex items-center gap-2">
          <label htmlFor="nextStatus" className="text-muted">then set to</label>
          <select id="nextStatus" name="status" value={nextStatus} onChange={(e) => setStatusChoice(e.target.value)} className="field field-sm w-auto">
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
          <SendButton internal={internal} />
        </div>
      </div>
    </form>
  );
}
