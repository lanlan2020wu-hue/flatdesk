"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({ children, pending }: { children: React.ReactNode; pending: string }) {
  const status = useFormStatus();
  return (
    <button disabled={status.pending} className="w-max rounded-md bg-accent px-4 py-2 text-accent-ink disabled:opacity-70">
      {status.pending ? pending : children}
    </button>
  );
}
