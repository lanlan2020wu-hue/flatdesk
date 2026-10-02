import Link from "next/link";
import { requireEditor } from "@/lib/auth";
import ArticleForm from "../ArticleForm";

export const metadata = { title: "New article" };

export default async function NewArticle() {
  await requireEditor();
  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <Link href="/app/help" className="link w-max text-sm text-muted">Help center</Link>
      <h1 className="page-title">New article</h1>
      <ArticleForm />
    </div>
  );
}
