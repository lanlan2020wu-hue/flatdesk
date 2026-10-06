import { notFound } from "next/navigation";
import { helpCenter } from "./data";

// Each page draws its own frame (HelpFrame), since the frame's words follow the page's language.
export default async function HelpLayout({ children, params }: LayoutProps<"/help/[org]">) {
  if (!(await helpCenter((await params).org))) notFound();
  return children;
}
