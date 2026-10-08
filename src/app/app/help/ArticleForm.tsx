import { MAX_BODY, MAX_SECTION, MAX_TITLE } from "@/lib/help";
import { saveArticleAction } from "./actions";

const TEMPLATE = `One or two sentences that answer the question.

## Steps
1. First step
2. Second step

## Still stuck?
- Something to check
- Another thing to check`;

// suggestedTitle: a new article started from a search that found nothing.
export default function ArticleForm({ article, sections = [], suggestedTitle }: { article?: { id: string; title: string; body: string; published: boolean; internal: boolean; section: string | null }; sections?: string[]; suggestedTitle?: string }) {
  return (
    <form action={saveArticleAction} className="grid gap-4 text-sm">
      {article && <input type="hidden" name="id" value={article.id} />}
      <label className="grid gap-1.5 font-medium" htmlFor="title">
        Title
        <input id="title" name="title" required maxLength={MAX_TITLE} defaultValue={article?.title ?? suggestedTitle} placeholder="How do I reset my password?" className="field font-normal" />
      </label>
      <label className="grid gap-1.5 font-medium" htmlFor="section">
        Section <span className="font-normal text-muted">(optional)</span>
        <input id="section" name="section" maxLength={MAX_SECTION} list="help-sections" defaultValue={article?.section ?? ""} placeholder="Billing" className="field font-normal" />
        <datalist id="help-sections">
          {sections.map((s) => <option key={s} value={s} />)}
        </datalist>
        <span className="text-xs font-normal text-muted">Articles with the same section are listed together on your help center.</span>
      </label>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 font-medium">Who reads it</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="internal" value="" defaultChecked={!article?.internal} className="mt-1" />
          <span>Customers. It goes on your help center, and the AI can answer from it and link to it.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="internal" value="1" defaultChecked={article?.internal} className="mt-1" />
          <span>Your team only. Internal how-tos and policies: never public, and the AI that answers customers doesn&apos;t see it. AI drafts for your team do use it.</span>
        </label>
      </fieldset>
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
