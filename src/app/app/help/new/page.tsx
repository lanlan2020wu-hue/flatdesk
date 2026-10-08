import Link from "next/link";
import { requireEditor, requireOpenPage } from "@/lib/auth";
import { articleSections } from "@/lib/help";
import ArticleForm from "../ArticleForm";

export const metadata = { title: "New article" };

export default async function NewArticle({ searchParams }: PageProps<"/app/help/new">) {
  const s = await requireOpenPage();
  await requireEditor();
  const sections = await articleSections(s.orgId);
  const { title } = await searchParams;
  const suggested = typeof title === "string" ? title.trim().slice(0, 120) : "";
  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <Link href="/app/help" className="link w-max text-sm text-muted">Help center</Link>
      <h1 className="page-title">New article</h1>
      {suggested && <p className="text-sm text-muted">Customers searched the help center for “{suggested}” and found nothing. Give the article the words they use.</p>}
      <ArticleForm sections={sections} suggestedTitle={suggested ? suggested[0].toUpperCase() + suggested.slice(1) : undefined} />
    </div>
  );
}
