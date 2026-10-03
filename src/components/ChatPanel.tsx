"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Message = { id: string; from: string; mine: boolean; body: string; at: string; files?: { name: string; size: number; url: string }[] };
type Saved = { number: number; token: string };

const POLL_MS = 5000;
// Mirrors REPLY_UPLOAD_LIMIT and MAX_FILES in lib/attachments.ts (Vercel caps request bodies at 4.5 MB).
const UPLOAD_LIMIT = 4 * 1024 * 1024;
const MAX_FILES = 10;

function fileProblem(files: File[]) {
  if (files.length > MAX_FILES) return `Attach up to ${MAX_FILES} files per message.`;
  if (files.reduce((n, f) => n + f.size, 0) > UPLOAD_LIMIT) return "Files on one message can add up to 4 MB.";
  return null;
}

const clip = (
  <svg viewBox="0 0 20 20" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M13.5 6.5 7.8 12.2a1.6 1.6 0 1 0 2.3 2.3l6-6a3.2 3.2 0 0 0-4.5-4.5l-6 6a4.8 4.8 0 0 0 6.8 6.8l5-5" /></svg>
);

// The files picked for the next message, each removable.
function Picked({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Attached files">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-md border border-line bg-bg py-0.5 pl-2 pr-1 text-xs">
          {clip}
          <span className="truncate">{f.name}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`} className="rounded px-1 text-muted hover:bg-surface">
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

// fresh: start a new conversation (the form) instead of picking up the saved one.
export default function ChatPanel({ widgetKey, teamName, fresh = false }: { widgetKey: string; teamName: string; fresh?: boolean }) {
  const storageKey = `flatdesk-chat-${widgetKey}`;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(list: FileList | null) {
    const next = [...files, ...Array.from(list ?? [])];
    if (fileRef.current) fileRef.current.value = "";
    const problem = fileProblem(next);
    setError(problem);
    if (!problem) setFiles(next);
  }
  const removeFile = (i: number) => setFiles(files.filter((_, j) => j !== i));

  // Multipart when files are attached; JSON otherwise.
  function payload(fields: Record<string, string>) {
    if (!files.length) return { headers: { "content-type": "application/json" }, body: JSON.stringify(fields) };
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    for (const f of files) body.append("files", f);
    return { body };
  }

  // Pick up a conversation from an earlier visit (after hydration, since the
  // server can't see localStorage).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (fresh) return localStorage.removeItem(storageKey);
        const raw = localStorage.getItem(storageKey);
        if (raw) setSaved(JSON.parse(raw) as Saved);
      } catch {
        // storage blocked: the conversation just won't survive a reload
      }
    }, 0);
    return () => clearTimeout(t);
  }, [storageKey, fresh]);

  // Back to the form, so the next message is a new ticket with its own name and email.
  function startOver() {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    setSaved(null);
    setMessages([]);
    setFiles([]);
    setError(null);
  }

  const refresh = useCallback(async () => {
    if (!saved) return;
    const r = await fetch(`/api/chat/${widgetKey}/${saved.number}`, { headers: { "x-visitor-token": saved.token }, cache: "no-store" });
    if (r.status === 404) {
      setSaved(null);
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      return;
    }
    if (r.ok) setMessages((await r.json()).messages);
  }, [saved, widgetKey, storageKey]);

  useEffect(() => {
    if (!saved) return;
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [saved, refresh]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // widget.js asks for focus when the chat opens, so keyboard users land in the first field.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent || e.data !== "flatdesk:focus") return;
      document.querySelector<HTMLElement>('input[name="name"], #chat-message')?.focus();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function start(form: FormData) {
    setSending(true);
    setError(null);
    const text = (k: string) => String(form.get(k) ?? "");
    const r = await fetch(`/api/chat/${widgetKey}`, {
      method: "POST",
      ...payload({ name: text("name"), email: text("email"), message: text("message"), website: text("website") }),
    }).catch(() => null);
    const data = r ? await r.json().catch(() => ({})) : {};
    setSending(false);
    if (!r?.ok) return setError(data.error ?? "Something went wrong. Please try again.");
    setFiles([]);
    const next = { number: data.number, token: data.token };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
    setSaved(next);
  }

  async function send(form: FormData, el: HTMLFormElement) {
    if (!saved) return;
    const message = String(form.get("message") ?? "").trim();
    if (!message && !files.length) return;
    setSending(true);
    setError(null);
    const r = await fetch(`/api/chat/${widgetKey}/${saved.number}`, {
      method: "POST",
      ...payload({ token: saved.token, message }),
    }).catch(() => null);
    const data = r ? await r.json().catch(() => ({})) : {};
    setSending(false);
    if (!r?.ok) return setError(data.error ?? "Your message didn't send. Please try again.");
    el.reset();
    setFiles([]);
    setMessages(data.messages);
  }

  const field = "w-full rounded-md border border-line bg-surface px-3 py-2";
  const fileInput = (
    <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.currentTarget.files)} />
  );
  const attachButton = (label: string, className: string) => (
    <button type="button" onClick={() => fileRef.current?.click()} className={className} aria-label={label === "" ? "Attach files" : undefined}>
      {clip}
      {label}
    </button>
  );

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex items-start justify-between gap-2 border-b border-line bg-surface px-4 py-3">
        <div>
          <p className="font-medium">{teamName}</p>
          <p className="text-sm text-muted">We reply here and by email.</p>
        </div>
        <div className="flex items-center gap-1">
          {saved && (
            <button type="button" onClick={startOver} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-bg">
              New conversation
            </button>
          )}
          <button type="button" aria-label="Close chat" onClick={() => window.parent.postMessage("flatdesk:close", "*")} className="rounded-md px-2 text-xl leading-none text-muted hover:bg-bg">
            ×
          </button>
        </div>
      </header>

      {!saved ? (
        <form
          className="grid flex-1 content-start gap-3 overflow-y-auto p-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(new FormData(e.currentTarget));
          }}
        >
          <label className="grid gap-1 text-sm">
            Name
            <input name="name" autoComplete="name" className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            Email
            <input name="email" type="email" required autoComplete="email" className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            How can we help?
            <textarea name="message" required rows={5} className={field} />
          </label>
          <div className="grid gap-2">
            {attachButton("Attach files", "flex w-fit items-center gap-1.5 text-sm text-muted underline-offset-2 hover:underline")}
            <Picked files={files} onRemove={removeFile} />
          </div>
          <div aria-hidden="true" className="sr-only">
            <label>
              Leave this empty
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          {fileInput}
          {error && <p className="text-sm text-warn">{error}</p>}
          <button disabled={sending} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">
            {sending ? "Sending…" : "Start chat"}
          </button>
        </form>
      ) : (
        <>
          <ol ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
            {messages.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 ${m.mine ? "self-end bg-accent text-accent-ink" : "self-start border border-line bg-surface"}`}>
                {!m.mine && <p className="text-xs font-medium text-muted">{m.from}</p>}
                {m.body && <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>}
                {m.files?.map((f) => (
                  <a key={f.url} href={f.url} target="_blank" rel="noopener" className="mt-1 flex items-center gap-1.5 text-sm underline underline-offset-2">
                    {clip}
                    <span className="truncate">{f.name}</span>
                  </a>
                ))}
              </li>
            ))}
            {messages.length > 0 && messages.every((m) => m.mine) && (
              <li className="self-center text-sm text-muted">Thanks, we&apos;ve got your message. Replies show up here and in your email.</li>
            )}
          </ol>
          <form
            className="grid gap-2 border-t border-line bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(new FormData(e.currentTarget), e.currentTarget);
            }}
          >
            <Picked files={files} onRemove={removeFile} />
            <div className="flex gap-2">
              {attachButton("", "grid w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-bg")}
              <label className="sr-only" htmlFor="chat-message">Message</label>
              <textarea id="chat-message" name="message" rows={1} placeholder="Write a message…" className={`${field} resize-none`} />
              <button disabled={sending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
                Send
              </button>
            </div>
            {fileInput}
          </form>
          {error && <p className="bg-surface px-3 pb-2 text-sm text-warn">{error}</p>}
        </>
      )}
    </div>
  );
}
