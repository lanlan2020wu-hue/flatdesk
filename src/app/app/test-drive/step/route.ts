import { requireSession } from "@/lib/auth";
import { runTestDriveStep } from "@/lib/test-drive";

// The test drive page calls this in a loop while drafts are queued. Each call
// drafts a few tickets in parallel and returns where the run stands.
export const maxDuration = 120; // one model call can take up to TEST_DRIVE.callTimeoutMs

export async function POST() {
  const s = await requireSession();
  return Response.json(await runTestDriveStep(s.orgId));
}
