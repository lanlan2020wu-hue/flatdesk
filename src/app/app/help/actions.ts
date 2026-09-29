"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin, requireEditor } from "@/lib/auth";
import { access } from "@/lib/billing";
import { MAX_BODY, MAX_TITLE, uniqueArticleSlug, validHelpSlug } from "@/lib/help";

const { articles, orgs } = schema;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

async function requireOpenEditor() {
  const s = await requireEditor();
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, s.orgId) });
  if (org && access(org).state === "locked") throw new Error("The free trial has ended. An admin can add a card in Settings.");
  return s;
}

function revalidate(helpSlug?: string | null) {
  revalidatePath("/app/help", "layout");
  if (helpSlug) revalidatePath(`/help/${helpSlug}`, "layout");
}

async function helpSlugOf(orgId: string) {
  return (await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { helpSlug: true } }))?.helpSlug;
}

// Creates or updates an article. The button pressed decides whether it's published.
export async function saveArticleAction(form: FormData) {
  const s = await requireOpenEditor();
  const id = str(form, "id");
  const title = str(form, "title").slice(0, MAX_TITLE);
  const body = String(form.get("body") ?? "").replace(/\r\n?/g, "\n").trim();
  const intent = str(form, "intent"); // "publish", "draft" or "save" (keep as is)
  if (!title || !body) throw new Error("An article needs a title and some text.");
  if (body.length > MAX_BODY) throw new Error(`Articles can be up to ${MAX_BODY.toLocaleString("en-US")} characters.`);

  let articleId = id;
  if (id) {
    if (!isId(id)) return;
    const patch: Partial<typeof articles.$inferInsert> = { title, body, updatedAt: new Date() };
    if (intent === "publish") patch.published = true;
    if (intent === "draft") patch.published = false;
    await db.update(articles).set(patch).where(and(eq(articles.orgId, s.orgId), eq(articles.id, id)));
  } else {
    // Two people saving the same title at once: the unique index catches it and the second gets the next slug.
    for (let attempt = 0; ; attempt++) {
      try {
        const slug = await uniqueArticleSlug(s.orgId, title);
        const [row] = await db
          .insert(articles)
          .values({ orgId: s.orgId, title, body, slug, published: intent === "publish" })
          .returning({ id: articles.id });
        articleId = row.id;
        break;
      } catch (err) {
        if (attempt >= 2 || (err as { code?: string }).code !== "23505") throw err;
      }
    }
  }
  revalidate(await helpSlugOf(s.orgId));
  redirect(`/app/help/${articleId}?saved=${intent === "publish" ? "published" : intent === "draft" ? "unpublished" : "saved"}`);
}

export async function deleteArticleAction(form: FormData) {
  const s = await requireOpenEditor();
  const id = str(form, "id");
  if (!isId(id)) return;
  await db.delete(articles).where(and(eq(articles.orgId, s.orgId), eq(articles.id, id)));
  revalidate(await helpSlugOf(s.orgId));
  redirect("/app/help");
}

// The public address, /help/<slug>. Admins only, since it changes links customers already have.
export async function saveHelpSlugAction(form: FormData) {
  const s = await requireAdmin();
  const slug = str(form, "helpSlug").toLowerCase();
  const old = await helpSlugOf(s.orgId);
  if (slug === old) redirect("/app/help");
  if (!validHelpSlug(slug)) redirect(`/app/help?${new URLSearchParams({ error: "Use 3 to 40 lowercase letters, numbers and single dashes, starting and ending with a letter or number." })}`);
  const [taken] = await db.select({ n: sql<number>`1` }).from(orgs).where(eq(orgs.helpSlug, slug)).limit(1);
  if (taken) redirect(`/app/help?${new URLSearchParams({ error: `${slug} is taken. Try another address.` })}`);
  try {
    await db.update(orgs).set({ helpSlug: slug }).where(eq(orgs.id, s.orgId));
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err;
    redirect(`/app/help?${new URLSearchParams({ error: `${slug} is taken. Try another address.` })}`);
  }
  revalidate(old);
  revalidate(slug);
  redirect("/app/help?saved=address");
}
