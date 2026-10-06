"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runInsightsAction } from "@/app/app/reports/actions";

export default function InsightsButton({ days, label }: { days: number; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <button
        type="button"
        disabled={pending}
        className="btn btn-secondary btn-sm w-max"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await runInsightsAction(days);
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Reading tickets… (up to a minute)" : label}
      </button>
      {error && <p className="text-sm text-warn" role="alert">{error}</p>}
    </div>
  );
}
