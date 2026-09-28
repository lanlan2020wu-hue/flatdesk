import { llmsFullTxt } from "@/lib/llms";

// Built once at deploy time from the same data as the pages.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsFullTxt(), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
