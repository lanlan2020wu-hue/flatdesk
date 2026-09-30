// The copilot's limits and rewrite options. Kept apart from lib/copilot.ts so
// the composer (a client component) and marketing pages can use them without
// pulling in the database.

export const COPILOT = {
  perAgent: 300, // actions per seat per month, pooled
  trialSeatCap: 10, // a trial's limit is sized from at most this many people
  threadChars: 24_000, // the most conversation text one call reads
};

export const REWRITE_STYLES = {
  shorter: "Make it shorter. Keep every fact, link and step; cut repetition and filler.",
  friendlier: "Make it warmer and friendlier without adding facts or promises.",
  formal: "Make it more formal and precise without changing what it says.",
  fix: "Fix spelling, grammar and punctuation only. Change nothing else.",
} as const;
export type RewriteStyle = keyof typeof REWRITE_STYLES;
export const REWRITE_LABEL: Record<RewriteStyle, string> = { shorter: "Shorter", friendlier: "Friendlier", formal: "More formal", fix: "Fix grammar" };
