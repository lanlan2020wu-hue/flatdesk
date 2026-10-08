import { after } from "next/server";
import { handleSlackInteraction } from "@/lib/integrations/slack-actions";
import { verifySlackRequest } from "@/lib/integrations/slack";

// Buttons and forms in Slack (lib/integrations/slack-actions.ts). Slack wants
// an answer within 3 seconds, so slow work runs after the response.
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySlackRequest(request.headers, raw)) return new Response("Bad signature", { status: 401 });
  const payload = new URLSearchParams(raw).get("payload");
  if (!payload) return new Response("No payload", { status: 400 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  const { response, later } = await handleSlackInteraction(parsed);
  if (later) after(later);
  return response ? Response.json(response) : new Response(null, { status: 200 });
}
