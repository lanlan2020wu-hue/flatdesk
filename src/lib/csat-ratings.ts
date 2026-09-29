// The rating choices, safe to import in the browser (lib/csat.ts reads the database).

export type Rating = "great" | "okay" | "bad";

export const RATINGS: { id: Rating; label: string; emoji: string }[] = [
  { id: "great", label: "Great", emoji: "😀" },
  { id: "okay", label: "Okay", emoji: "😐" },
  { id: "bad", label: "Not good", emoji: "🙁" },
];

export const RATING_LABEL: Record<Rating, string> = { great: "Great", okay: "Okay", bad: "Not good" };

export function isRating(v: unknown): v is Rating {
  return RATINGS.some((r) => r.id === v);
}

