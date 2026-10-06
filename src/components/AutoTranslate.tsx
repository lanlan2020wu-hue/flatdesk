"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { translateTicketAction } from "@/app/app/actions";

// Shown on a ticket with customer messages in another language: translates
// them once in the background, then shows the page again with the translations.
export default function AutoTranslate({ ticketId, label }: { ticketId: string; label: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"working" | "failed">("working");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    translateTicketAction(ticketId).then((n) => (n > 0 ? router.refresh() : setState("failed")), () => setState("failed"));
  }, [ticketId, router]);
  if (state === "failed") return null;
  return (
    <p className="text-sm text-muted" role="status">
      Translating the customer&apos;s messages into {label}…
    </p>
  );
}
