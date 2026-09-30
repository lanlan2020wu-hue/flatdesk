import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MODEL, callCost } from "@/lib/ai";

export type Metered = { model: string; inputTokens: number; outputTokens: number; costUsd: string };

// One short structured call, for the AI features that help the team rather
// than answer customers: AI macros and the copilot. Same
// model as AI answers, at low effort, because these are small jobs.
// Returns null output on a refusal. Throws on API errors.
export async function structuredCall<T extends z.ZodType>(
  schema: T,
  system: string,
  user: string,
  options: { timeout?: number; maxRetries?: number } = { timeout: 60_000, maxRetries: 1 },
): Promise<{ out: z.infer<T> | null; metered: Metered }> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    },
    options,
  );
  const usage = response.usage;
  const inputTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const metered = { model: response.model, inputTokens, outputTokens: usage.output_tokens, costUsd: callCost(usage).toFixed(5) };
  const out = response.stop_reason === "refusal" ? null : (response.parsed_output as z.infer<T> | null);
  return { out, metered };
}
