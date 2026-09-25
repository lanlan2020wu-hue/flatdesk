"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Drives a running import: asks the server for one step at a time and
// refreshes the page between steps. Closing the page pauses the import.
export default function ImportRunner({ id, retryAt }: { id: string; retryAt: string | null }) {
  const router = useRouter();
  // The page re-renders with a new retryAt after every step; only the first one starts the loop.
  const [initialRetryAt] = useState(retryAt);
  const [waitingUntil, setWaitingUntil] = useState<string | null>(retryAt);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    let stopped = false;
    (async () => {
      let wait = initialRetryAt ? new Date(initialRetryAt).getTime() - Date.now() : 0;
      let failures = 0;
      while (!stopped) {
        if (wait > 0) await sleep(wait);
        if (stopped) return;
        try {
          const res = await fetch(`/app/import/${id}/step`, { method: "POST" });
          if (!res.ok) throw new Error(String(res.status));
          const job: { status: string; retryAt: string | null; busy: boolean } = await res.json();
          failures = 0;
          setProblem(false);
          setWaitingUntil(job.retryAt);
          router.refresh();
          if (job.status !== "running") return;
          wait = job.retryAt ? new Date(job.retryAt).getTime() - Date.now() : job.busy ? 3000 : 0;
        } catch {
          failures++;
          setProblem(failures > 2);
          wait = Math.min(30_000, 2000 * failures);
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [id, initialRetryAt, router]);

  return (
    <p aria-live="polite" className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
      {problem
        ? "Having trouble reaching the server. Retrying…"
        : waitingUntil && new Date(waitingUntil) > new Date()
          ? "The old help desk asked us to slow down. Continuing in a moment…"
          : "Importing. Keep this page open; if you close it, the import pauses and continues when you come back."}
    </p>
  );
}
