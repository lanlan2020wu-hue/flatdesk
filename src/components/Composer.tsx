"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

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
}: {
  action: (f: FormData) => Promise<void>;
  ticketId: string;
  number: number;
  status: string;
  macros: Macro[];
}) {
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const [addTags, setAddTags] = useState("");
  // Replies default to "pending" (waiting on the customer); notes keep the current status.
  const [statusChoice, setStatusChoice] = useState<string | null>(null);
  const nextStatus = statusChoice ?? (internal ? status : "pending");
  const formRef = useRef<HTMLFormElement>(null);

  function applyMacro(id: string) {
    const m = macros.find((x) => x.id === id);
    if (!m) return;
    setBody((b) => (b ? `${b}\n\n${m.body}` : m.body));
    setAddTags(m.addTags.join(", "));
    if (m.setStatus) setStatusChoice(m.setStatus);
  }

  return (
    <form
      ref={formRef}
      action={async (f) => {
        await action(f);
        setBody("");
        setAddTags("");
        setStatusChoice(null);
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
      </div>
      <label htmlFor="composer" className="sr-only">{internal ? "Internal note" : "Reply"}</label>
      <textarea
        id="composer"
        name="body"
        rows={6}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") formRef.current?.requestSubmit();
        }}
        placeholder={internal ? "Only your team sees this." : "Write your reply…"}
        className="w-full resize-y rounded-lg bg-transparent px-2 py-1 focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm">
        <span className="text-muted">{addTags && <>Adds tags: {addTags}</>}</span>
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
