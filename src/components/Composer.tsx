"use client";

import { useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { copilotDraftAction, copilotRewriteAction } from "@/app/app/actions";
import { CopilotMark } from "@/components/CopilotSummary";
import { REWRITE_LABEL, type RewriteStyle } from "@/lib/copilot-config";

// Mirrors REPLY_UPLOAD_LIMIT and MAX_FILES in lib/attachments.ts (Vercel caps request bodies at 4.5 MB).
const UPLOAD_LIMIT = 4 * 1024 * 1024;
const MAX_FILES = 10;

type Macro = { id: string; name: string; body: string; addTags: string[]; setStatus: string | null };

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
}: {
  action: (f: FormData) => Promise<void>;
  ticketId: string;
  number: number;
  status: string;
  macros: Macro[];
  // The macro Flatdesk identified as the answer to the customer's latest message.
  suggestedMacroId?: string | null;
  copilot?: boolean;
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

  function applyMacro(id: string) {
    const m = macros.find((x) => x.id === id);
    if (!m) return;
    setBody((b) => (b ? `${b}\n\n${m.body}` : m.body));
    setAddTags(m.addTags.join(", "));
    if (m.setStatus) setStatusChoice(m.setStatus);
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
        try {
          await action(f);
        } catch {
          return setError("That didn't save. Check your connection and try again; your text is still here.");
        }
        setBody("");
        setNote(null);
        setAddTags("");
        setStatusChoice(null);
        setFiles([]);
      }}
      className={`grid gap-3 rounded-2xl border p-3 shadow-md transition-colors focus-within:ring-2 focus-within:ring-accent/25 ${internal ? "border-warn/50 bg-warn-soft" : "border-line bg-surface"}`}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="addTags" value={addTags} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="radiogroup" aria-label="Message type" className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          <button type="button" role="radio" aria-checked={!internal} onClick={() => setInternal(false)} className={`rounded-md px-3 py-1 transition-colors ${!internal ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}>Reply</button>
          <button type="button" role="radio" aria-checked={internal} onClick={() => setInternal(true)} className={`rounded-md px-3 py-1 transition-colors ${internal ? "bg-surface font-medium text-warn shadow-sm" : "text-muted hover:text-ink"}`}>Internal note</button>
        </div>
        {internal && <input type="hidden" name="internal" value="on" />}
        {macros.length > 0 && (
          <select aria-label="Insert macro" className="field field-sm w-auto" value="" onChange={(e) => applyMacro(e.target.value)}>
            <option value="">Insert macro…</option>
            {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {copilot && (
          <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button type="button" onClick={draft} disabled={thinking} className="btn btn-secondary btn-sm text-accent">
              <CopilotMark />
              Draft reply
            </button>
            <select
              aria-label="Rewrite with the copilot"
              className="field field-sm w-auto"
              value=""
              disabled={thinking || !body.trim()}
              onChange={(e) => e.target.value && rewrite(e.target.value as RewriteStyle)}
            >
              <option value="">Rewrite…</option>
              {(Object.keys(REWRITE_LABEL) as RewriteStyle[]).map((k) => <option key={k} value={k}>{REWRITE_LABEL[k]}</option>)}
            </select>
          </span>
        )}
      </div>
      {suggested && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
          <CopilotMark className="size-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            This looks like <strong className="font-medium">{suggested.name}</strong>, one of your macros.
          </span>
          <button type="button" onClick={() => applyMacro(suggested.id)} className="btn btn-primary btn-sm">Use macro</button>
          <button type="button" onClick={() => setUsedSuggestion(true)} className="link px-1 text-muted">Dismiss</button>
        </p>
      )}
      <label htmlFor="composer" className="sr-only">{internal ? "Internal note" : "Reply"}</label>
      <textarea
        id="composer"
        name="body"
        rows={6}
        value={body}
        readOnly={thinking}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") formRef.current?.requestSubmit();
        }}
        placeholder={internal ? "Only your team sees this." : "Write your reply…"}
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
                const picked = [...files, ...Array.from(e.target.files ?? [])];
                e.target.value = "";
                const total = picked.reduce((n, f) => n + f.size, 0);
                if (picked.length > MAX_FILES) return setError(`Attach up to ${MAX_FILES} files per reply.`);
                if (total > UPLOAD_LIMIT) return setError("Attachments on one reply can add up to 4 MB. Share bigger files as a link.");
                setError(null);
                setFiles(picked);
              }}
            />
          </label>
          {addTags && <span>Adds tags: {addTags}</span>}
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
