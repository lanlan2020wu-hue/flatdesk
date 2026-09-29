import { notFound } from "next/navigation";
import RatingPanel from "@/components/RatingPanel";
import { isRating, ratableReply } from "@/lib/csat";

export const metadata = { title: "Rate this reply", robots: { index: false } };

// Where the rating links in reply emails land. The page records the click
// from the browser (see RatingPanel), so a mail scanner fetching the link
// doesn't rate anything.
export default async function RatePage({ params }: PageProps<"/rate/[id]/[rating]">) {
  const { id, rating } = await params;
  if (!isRating(rating)) notFound();
  const found = await ratableReply(id);
  if (!found) notFound();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <RatingPanel messageId={id} initial={rating} teamName={found.org.name} ticketNumber={found.ticket.number} />
    </main>
  );
}
