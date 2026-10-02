"use client";

import { useId, useState } from "react";

const MAX_SHOWN = 8;

// A tag field that suggests the team's existing tags as you type, so
// "billing" doesn't turn into "Billing" and "billing-issue" over time.
// With `multiple`, the value is a comma-separated list and the suggestions
// complete the tag after the last comma.
export default function TagInput({
  tags,
  multiple = true,
  defaultValue = "",
  className = "field",
  ...props
}: { tags: string[]; multiple?: boolean; defaultValue?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onChange">) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  const parts = multiple ? value.split(",") : [value];
  const typed = parts[parts.length - 1].trim().toLowerCase();
  const used = new Set(parts.slice(0, -1).map((p) => p.trim().toLowerCase()));
  const free = tags.filter((t) => !used.has(t) && t !== typed);
  // Tags that start with what's typed come first, then ones that contain it.
  const matches = (typed ? [...free.filter((t) => t.startsWith(typed)), ...free.filter((t) => !t.startsWith(typed) && t.includes(typed))] : free).slice(0, MAX_SHOWN);
  const shown = open && matches.length > 0;

  function accept(tag: string) {
    if (multiple) {
      const before = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
      setValue([...before, tag].join(", ") + ", ");
    } else {
      setValue(tag);
      setOpen(false);
    }
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!shown) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
      e.preventDefault();
      accept(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <span className="relative block">
      <input
        {...props}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        className={`${className} w-full`}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface py-1 text-sm font-normal shadow-lg">
          {matches.map((t, i) => (
            <li
              key={t}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Mouse down, not click: a click would blur the input first and close the list.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(t);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-accent-soft text-accent" : ""}`}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
