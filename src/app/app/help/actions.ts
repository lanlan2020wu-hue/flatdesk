"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin, requireEditor, requireOpen } from "@/lib/auth";
import { CopilotError, translateArticle } from "@/lib/copilot";
import { addDomain, DOMAIN_RULE, DomainError, domainsConfigured, domainStatus, normalizeDomain, removeDomain } from "@/lib/domains";
import { MAX_BODY, MAX_HELP_LANGUAGES, MAX_SECTION, MAX_TITLE, uniqueArticleSlug, validHelpSlug } from "@/lib/help";
import { isUuid } from "@/lib/ids";
import { isLanguage } from "@/lib/language";
import { audit } from "@/lib/security";

const { articles, articleTranslations, orgs } = schema;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isId = isUuid;

const requireOpenEditor = async () => requireOpen(await requireEditor());

function revalidate(helpSlug?: string | null) {
  revalidatePath("/app/help", "layout");
  if (helpSlug) revalidatePath(`/help/${helpSlug}`, "layout");
}

async function helpSlugOf(orgId: string) {
  return (await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { helpSlug: true } }))?.helpSlug;
}

const back = (params: Record<string, string>, hash = "") => redirect(`/app/help?${new URLSearchParams(params)}${hash}`);

// Creates or updates an article. The button pressed decides whether it's published.
export async function saveArticleAction(form: FormData) {
  const s = await requireOpenEditor();
  const id = str(form, "id");
  const title = str(form, "title").slice(0, MAX_TITLE);
  const body = String(form.get("body") ?? "").replace(/\r\n?/g, "\n").trim();
  const section = str(form, "section").replace(/\s+/g, " ").slice(0, MAX_SECTION) || null;
  const intent = str(form, "intent"); // "publish", "draft" or "save" (keep as is)
  const internal = str(form, "internal") === "1";
  if (!title || !body) throw new Error("An article needs a title and some text.");
  if (body.length > MAX_BODY) throw new Error(`Articles can be up to ${MAX_BODY.toLocaleString("en-US")} characters.`);

  let articleId = id;
  if (id) {
    if (!isId(id)) return;
    const patch: Partial<typeof articles.$inferInsert> = { title, body, section, internal, updatedAt: new Date() };
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
          .values({ orgId: s.orgId, title, body, section, internal, slug, published: intent === "publish" })
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
  const s = await requireOpen(await requireAdmin());
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

// ---- Own domain ---------------------------------------------------------------

// Connects (or with an empty field, disconnects) the team's own address.
export async function saveHelpDomainAction(form: FormData) {
  const s = await requireOpen(await requireAdmin());
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, s.orgId), columns: { helpDomain: true, helpSlug: true } });
  const raw = str(form, "helpDomain");
  const domain = raw ? normalizeDomain(raw) : null;
  if (raw && !domain) back({ domainError: `Use ${DOMAIN_RULE}.` }, "#domain");
  if (domain === (org?.helpDomain ?? null)) back({}, "#domain");
  if (domain) {
    if (!domainsConfigured()) back({ domainError: "Custom addresses aren't switched on for this workspace yet." }, "#domain");
    const [taken] = await db.select({ n: sql<number>`1` }).from(orgs).where(eq(orgs.helpDomain, domain)).limit(1);
    if (taken) back({ domainError: `${domain} is already used by another Flatdesk team.` }, "#domain");
    try {
      await addDomain(domain);
    } catch (err) {
      if (err instanceof DomainError) back({ domainError: err.message }, "#domain");
      throw err;
    }
  }
  try {
    await db.update(orgs).set({ helpDomain: domain, helpDomainVerifiedAt: null }).where(eq(orgs.id, s.orgId));
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err;
    back({ domainError: `${domain} is already used by another Flatdesk team.` }, "#domain");
  }
  if (org?.helpDomain) await removeDomain(org.helpDomain);
  await audit(s.orgId, { userId: s.userId, name: s.name }, "settings.help_domain", domain ? `${org?.helpDomain ?? "none"} → ${domain}` : `Removed ${org?.helpDomain}`);
  revalidate(org?.helpSlug);
  back(domain ? { saved: "domain" } : { saved: "domain-removed" }, "#domain");
}

// Asks Vercel whether the address is pointed here and serving yet.
export async function checkHelpDomainAction() {
  const s = await requireOpen(await requireAdmin());
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, s.orgId), columns: { helpDomain: true, helpSlug: true, helpDomainVerifiedAt: true } });
  if (!org?.helpDomain) back({}, "#domain");
  const status = await domainStatus(org!.helpDomain!);
  if (status.state === "unknown") back({ domainError: "Couldn't check the address just now. Try again in a minute." }, "#domain");
  const ready = status.state === "ready";
  await db.update(orgs).set({ helpDomainVerifiedAt: ready ? (org!.helpDomainVerifiedAt ?? new Date()) : null }).where(eq(orgs.id, s.orgId));
  revalidate(org!.helpSlug);
  back(ready ? { saved: "domain-ready" } : { domainError: "Not pointed here yet. DNS changes can take up to an hour to show." }, "#domain");
}

// ---- Languages ----------------------------------------------------------------

export async function saveHelpLanguagesAction(form: FormData) {
  const s = await requireOpen(await requireAdmin());
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, s.orgId), columns: { language: true, helpSlug: true } });
  const picked = [...new Set(form.getAll("languages").map(String))].filter((l) => isLanguage(l) && l !== org?.language).slice(0, MAX_HELP_LANGUAGES);
  await db.update(orgs).set({ helpLanguages: picked }).where(eq(orgs.id, s.orgId));
  revalidate(org?.helpSlug);
  back({ saved: "languages" }, "#languages");
}

async function articleOf(orgId: string, id: string) {
  if (!isId(id)) return undefined;
  return db.query.articles.findFirst({ where: and(eq(articles.orgId, orgId), eq(articles.id, id)) });
}

const toArticle = (id: string, params: Record<string, string>) => redirect(`/app/help/${id}?${new URLSearchParams(params)}#translations`);

// A translation written or corrected by hand.
export async function saveTranslationAction(form: FormData) {
  const s = await requireOpenEditor();
  const article = await articleOf(s.orgId, str(form, "articleId"));
  const language = str(form, "language");
  if (!article || !isLanguage(language)) return;
  const title = str(form, "title").slice(0, MAX_TITLE);
  const body = String(form.get("body") ?? "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_BODY);
  if (!title || !body) toArticle(article.id, { translationError: "A translation needs a title and some text.", lang: language });
  const section = article.section ? str(form, "section").replace(/\s+/g, " ").slice(0, MAX_SECTION) || null : null;
  const values = { title, body, section, auto: false, sourceUpdatedAt: article.updatedAt, updatedAt: new Date() };
  await db
    .insert(articleTranslations)
    .values({ orgId: s.orgId, articleId: article.id, language, ...values })
    .onConflictDoUpdate({ target: [articleTranslations.articleId, articleTranslations.language], set: values });
  revalidate(await helpSlugOf(s.orgId));
  toArticle(article.id, { translated: language });
}

export async function deleteTranslationAction(form: FormData) {
  const s = await requireOpenEditor();
  const article = await articleOf(s.orgId, str(form, "articleId"));
  if (!article) return;
  await db.delete(articleTranslations).where(and(eq(articleTranslations.articleId, article.id), eq(articleTranslations.language, str(form, "language"))));
  revalidate(await helpSlugOf(s.orgId));
  toArticle(article.id, {});
}

// The AI translates the article into one language, or with language "all" into
// every offered language that has no translation or an out-of-date AI one.
// Hand-written translations are never overwritten in bulk.
export async function aiTranslateArticleAction(form: FormData) {
  const s = await requireOpenEditor();
  const article = await articleOf(s.orgId, str(form, "articleId"));
  if (!article) return;
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, s.orgId), columns: { helpLanguages: true, language: true, helpSlug: true } });
  const asked = str(form, "language");
  const existing = await db.select().from(articleTranslations).where(eq(articleTranslations.articleId, article.id));
  const todo =
    asked === "all"
      ? (org?.helpLanguages ?? []).filter((l) => {
          const t = existing.find((e) => e.language === l);
          return !t || (t.auto && t.sourceUpdatedAt < article.updatedAt);
        })
      : isLanguage(asked) && asked !== org?.language
        ? [asked]
        : [];
  let done = 0;
  for (const language of todo) {
    try {
      const out = await translateArticle(s.orgId, s.userId, article, language);
      const values = { ...out, auto: true, sourceUpdatedAt: article.updatedAt, updatedAt: new Date() };
      await db
        .insert(articleTranslations)
        .values({ orgId: s.orgId, articleId: article.id, language, ...values })
        .onConflictDoUpdate({ target: [articleTranslations.articleId, articleTranslations.language], set: values });
      done++;
    } catch (err) {
      if (done) revalidate(org?.helpSlug);
      if (err instanceof CopilotError) toArticle(article.id, { translationError: done ? `Translated ${done}, then stopped: ${err.message}` : err.message });
      throw err;
    }
  }
  revalidate(org?.helpSlug);
  toArticle(article.id, { translated: String(done) });
}
