import { MAX_BODY, MAX_TITLE } from "@/lib/help";
import { saveArticleAction } from "./actions";

const TEMPLATE = `One or two sentences that answer the question.

## Steps
1. First step
2. Second step

## Still stuck?
- Something to check
- Another thing to check`;

export default function ArticleForm({ article }: { article?: { id: string; title: string; body: string; published: boolean } }) {
  return (
    <form action={saveArticleAction} className="grid gap-4 text-sm">
      {article && <input type="hidden" name="id" value={article.id} />}
      <label className="grid gap-1.5 font-medium" htmlFor="title">
        Title
        <input id="title" name="title" required maxLength={MAX_TITLE} defaultValue={article?.title} placeholder="How do I reset my password?" className="field font-normal" />
      </label>
      <label className="grid gap-1.5 font-medium" htmlFor="body">
        Article
        <textarea
          id="body"
          name="body"
          required
          rows={18}
          maxLength={MAX_BODY}
          defaultValue={article?.body}
          placeholder={TEMPLATE}
          className="field font-normal leading-relaxed"
        />
      </label>
      <p className="-mt-2 text-xs text-muted">
        Plain text. Leave a blank line between paragraphs. <code>## Heading</code>, <code>- list item</code>, <code>1. step</code>,{" "}
        <code>**bold**</code> and <code>[link text](https://...)</code> work too.
      </p>
      <div className="flex flex-wrap gap-2">
        {article?.published ? (
          <>
            <button name="intent" value="save" className="btn btn-primary">Update</button>
            <button name="intent" value="draft" className="btn btn-secondary">Unpublish</button>
          </>
        ) : (
          <>
            <button name="intent" value="publish" className="btn btn-primary">Publish</button>
            <button name="intent" value="draft" className="btn btn-secondary">Save draft</button>
          </>
        )}
      </div>
    </form>
  );
}
