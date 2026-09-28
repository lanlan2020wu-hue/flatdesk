"use client";

import { useEffect } from "react";

// What people see when a page or an action fails. In production the server's
// message isn't passed to the browser, so this stays general and shows the
// reference that matches the server log.
export default function ErrorPanel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid max-w-lg gap-4 px-4 py-10 md:px-8 md:py-14" role="alert">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="font-display text-3xl">That didn&apos;t work</h1>
      <p className="text-muted">
        Nothing you had already saved is lost. Try again; if it keeps happening, email us and include the reference below.
      </p>
      <p className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-primary">Try again</button>
        <a href="/app/inbox" className="btn btn-secondary">Back to the inbox</a>
      </p>
      {error.digest && <p className="num text-xs text-muted">Reference: {error.digest}</p>}
    </div>
  );
}
