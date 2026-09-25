"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Message = { id: string; from: string; mine: boolean; body: string; at: string };
type Saved = { number: number; token: string };

const POLL_MS = 5000;

export default function ChatPanel({ widgetKey, teamName }: { widgetKey: string; teamName: string }) {
  const storageKey = `flatdesk-chat-${widgetKey}`;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // Pick up a conversation from an earlier visit (after hydration, since the
  // server can't see localStorage).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) setSaved(JSON.parse(raw) as Saved);
      } catch {
        // storage blocked: the conversation just won't survive a reload
      }
    }, 0);
    return () => clearTimeout(t);
  }, [storageKey]);

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

  async function start(form: FormData) {
    setSending(true);
    setError(null);
    const r = await fetch(`/api/chat/${widgetKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), email: form.get("email"), message: form.get("message") }),
    });
    const data = await r.json().catch(() => ({}));
    setSending(false);
    if (!r.ok) return setError(data.error ?? "Something went wrong. Please try again.");
    const next = { number: data.number, token: data.token };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
    setSaved(next);
  }

  async function send(form: FormData, el: HTMLFormElement) {
    if (!saved) return;
    const message = String(form.get("message") ?? "").trim();
    if (!message) return;
    setSending(true);
    setError(null);
    const r = await fetch(`/api/chat/${widgetKey}/${saved.number}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: saved.token, message }),
    });
    const data = await r.json().catch(() => ({}));
    setSending(false);
    if (!r.ok) return setError(data.error ?? "Your message didn't send. Please try again.");
    el.reset();
    setMessages(data.messages);
  }

  const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex items-start justify-between gap-2 border-b border-line bg-surface px-4 py-3">
        <div>
          <p className="font-medium">{teamName}</p>
          <p className="text-sm text-muted">We reply here and by email.</p>
        </div>
        <button type="button" aria-label="Close chat" onClick={() => window.parent.postMessage("flatdesk:close", "*")} className="rounded-md px-2 text-xl leading-none text-muted hover:bg-bg">
          ×
        </button>
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
                <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
              </li>
            ))}
            {messages.length > 0 && messages.every((m) => m.mine) && (
              <li className="self-center text-sm text-muted">Thanks, we&apos;ve got your message. Replies show up here and in your email.</li>
            )}
          </ol>
          <form
            className="flex gap-2 border-t border-line bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(new FormData(e.currentTarget), e.currentTarget);
            }}
          >
            <label className="sr-only" htmlFor="chat-message">Message</label>
            <textarea id="chat-message" name="message" rows={1} placeholder="Write a message…" className={`${field} resize-none`} />
            <button disabled={sending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
              Send
            </button>
          </form>
          {error && <p className="bg-surface px-3 pb-2 text-sm text-warn">{error}</p>}
        </>
      )}
    </div>
  );
}
