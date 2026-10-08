"use client";

import { useSyncExternalStore } from "react";

const FORMAT: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

const noop = () => () => {};

// A moment in the reader's own time zone. The server doesn't know it, so the
// first render says UTC and the browser swaps in local time.
export default function LocalTime({ at }: { at: string }) {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  const d = new Date(at);
  return <time dateTime={at}>{inBrowser ? d.toLocaleString(undefined, FORMAT) : `${d.toLocaleString("en-US", { ...FORMAT, timeZone: "UTC" })} UTC`}</time>;
}
