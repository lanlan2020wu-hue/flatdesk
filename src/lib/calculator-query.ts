import type { Interval } from "./pricing";

export type CalculatorStart = {
  initialTool: string;
  initialAgents: number;
  initialResolutions: number;
  initialInterval: Interval;
};

export const CALCULATOR_DEFAULTS: CalculatorStart = { initialTool: "fin-advanced", initialAgents: 10, initialResolutions: 1500, initialInterval: "year" };

type Query = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// The numbers a shared calculator link (?tool=&agents=&resolutions=&billing=)
// opens with. Anything missing or unreadable keeps its default.
export function calculatorStart(q: Query): CalculatorStart {
  const d = CALCULATOR_DEFAULTS;
  return {
    initialTool: first(q.tool) || d.initialTool,
    initialAgents: num(first(q.agents), d.initialAgents),
    initialResolutions: num(first(q.resolutions), d.initialResolutions),
    initialInterval: first(q.billing) === "monthly" ? "month" : d.initialInterval,
  };
}
