import { ApiError, customerJson, json, withKey } from "@/lib/api";

// GET /api/v1/customers?email=... : the customer and their tickets.
export async function GET(request: Request) {
  return withKey(request, async (caller) => {
    const address = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
    if (!address) throw new ApiError(400, "Add ?email= with the customer's email address.");
    return json({ customer: await customerJson(caller.orgId, address) });
  });
}
