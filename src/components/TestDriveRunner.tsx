"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Drives a test drive run: asks the server to draft a few tickets at a time
// and refreshes the page between steps. Closing the page pauses the run.
export default function TestDriveRunner() {
  const router = useRouter();
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    let stopped = false;
    (async () => {
      let failures = 0;
      while (!stopped) {
        try {
          const res = await fetch("/app/test-drive/step", { method: "POST" });
          if (!res.ok) throw new Error(String(res.status));
          const p: { finished: boolean; queued: number; running: number } = await res.json();
          failures = 0;
          setProblem(false);
          router.refresh();
          if (p.finished) return;
          // Nothing claimable yet: another tab or the budget reserve is holding the rest.
          if (p.queued === 0 || p.running > 0) await sleep(3000);
        } catch {
          failures++;
          setProblem(failures > 2);
          await sleep(Math.min(30_000, 2000 * failures));
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [router]);

  return (
    <p aria-live="polite" className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
      {problem
        ? "Having trouble reaching the server. Retrying…"
        : "Drafting. Keep this page open. If you close it, the test drive pauses until you come back."}
    </p>
  );
}
