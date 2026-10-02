// Bounds for what the team types into /app forms, so one paste can't store
// megabytes or overflow a column.
export const INPUT = {
  macroName: 200,
  macroBody: 8000,
  subject: 500,
  name: 200,
  email: 254,
  overageLimit: 100_000,
};

const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;
export const validEmail = (v: string) => v.length <= INPUT.email && EMAIL.test(v);

// The monthly overage cap: blank for none, otherwise a whole number of answers.
// Anything else is no cap rather than a number Postgres can't store.
export function parseOverageLimit(raw: string): number | null {
  const v = raw.trim();
  if (!/^\d+$/.test(v)) return null;
  return Math.min(Number(v), INPUT.overageLimit);
}
