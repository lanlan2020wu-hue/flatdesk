import { notFound } from "next/navigation";
import ChatPanel from "@/components/ChatPanel";
import { orgByWidgetKey } from "@/lib/chat";

export const metadata = { title: "Chat", robots: { index: false } };

// Rendered inside the widget's iframe on a customer's website.
export default async function ChatPage({ params }: PageProps<"/chat/[key]">) {
  const { key } = await params;
  const org = await orgByWidgetKey(key);
  if (!org) notFound();
  return <ChatPanel widgetKey={key} teamName={org.name} />;
}
