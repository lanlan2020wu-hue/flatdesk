import { requireSession } from "@/lib/auth";
import { monthKey } from "@/lib/ai";
import { monthReceipt, receiptCsv } from "@/lib/receipts";

export async function GET(req: Request) {
  const s = await requireSession();
  const raw = new URL(req.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : monthKey();
  const csv = receiptCsv(await monthReceipt(s.orgId, month));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="flatdesk-ai-receipt-${month}.csv"`,
    },
  });
}
