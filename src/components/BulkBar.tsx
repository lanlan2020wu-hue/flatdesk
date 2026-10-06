"use client";

import { useEffect, useState } from "react";
import { bulkUpdateAction } from "@/app/app/actions";

// The bar that appears once tickets are ticked in the inbox. Row checkboxes
// live in the list and join this form through form="bulk".
export default function BulkBar({ agents, groups = [], back, total }: { agents: { userId: string; name: string }[]; groups?: { id: string; name: string }[]; back: string; total: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[form="bulk"][name="ids"]')];
    const update = () => setCount(boxes().filter((b) => b.checked).length);
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, []);
  const all = (checked: boolean) => {
    for (const b of document.querySelectorAll<HTMLInputElement>('input[form="bulk"][name="ids"]')) b.checked = checked;
    setCount(checked ? total : 0);
  };
  return (
    <form id="bulk" action={bulkUpdateAction} className={`flex flex-wrap items-center gap-2 rounded-[8px] border px-3 py-2 text-sm ${count ? "border-accent/40 bg-accent-soft" : "border-line bg-surface"}`}>
      <input type="hidden" name="back" value={back} />
      <label className="flex items-center gap-2 pr-1">
        <input type="checkbox" checked={count > 0 && count === total} onChange={(e) => all(e.target.checked)} aria-label="Select all tickets shown" />
        <span className="font-medium">{count ? `${count} selected` : "Select"}</span>
      </label>
      {count > 0 && (
        <>
          <select name="status" defaultValue="" className="field field-sm w-auto" aria-label="Set status">
            <option value="">Status…</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
          <select name="assigneeId" defaultValue="" className="field field-sm w-auto" aria-label="Assign">
            <option value="">Assign…</option>
            <option value="none">Unassigned</option>
            {agents.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </select>
          {groups.length > 0 && (
            <select name="groupId" defaultValue="" className="field field-sm w-auto" aria-label="Set group">
              <option value="">Group…</option>
              <option value="none">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          <select name="priority" defaultValue="" className="field field-sm w-auto" aria-label="Set priority">
            <option value="">Priority…</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <input name="addTags" placeholder="Add tags" className="field field-sm w-32" aria-label="Add tags, separated by commas" />
          <button className="btn btn-primary btn-sm">Apply</button>
          <button type="button" className="link text-muted" onClick={() => all(false)}>
            Clear
          </button>
        </>
      )}
    </form>
  );
}
