import type { Instrumentation } from "next";

// Server errors go to the logs (Vercel keeps them) and, when ERROR_WEBHOOK_URL is
// set, to a chat channel too. The payload carries both `text` (Slack, Google Chat,
// Mattermost) and `content` (Discord) so any of them accepts it. Without the
// variable nothing leaves the server.
const seen = new Map<string, number>();
const WINDOW_MS = 10 * 60_000;

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const error = err instanceof Error ? err : new Error(String(err));
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  console.error(JSON.stringify({ level: "error", message: error.message, digest, method: request.method, path: request.path, route: context.routePath, type: context.routeType }));

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  // The same error on the same route is sent once per window, so a failing page can't flood the channel.
  const key = `${context.routePath}|${error.message}`;
  const now = Date.now();
  if ((seen.get(key) ?? 0) > now - WINDOW_MS) return;
  seen.set(key, now);
  if (seen.size > 200) for (const [k, t] of seen) if (t < now - WINDOW_MS) seen.delete(k);

  const text = `Flatdesk error on ${request.method} ${context.routePath} (${context.routeType}): ${error.message.slice(0, 300)}${digest ? ` [digest ${digest}]` : ""}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Reporting must never make the original failure worse.
  }
};
