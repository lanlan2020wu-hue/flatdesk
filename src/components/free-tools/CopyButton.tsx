"use client";

import { useState } from "react";

// Copies a block of text and says so for two seconds.
export default function CopyButton({ text, label = "Copy", className = "btn btn-secondary btn-sm" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" onClick={copy} className={className} aria-live="polite">
      {copied ? "Copied" : label}
    </button>
  );
}
