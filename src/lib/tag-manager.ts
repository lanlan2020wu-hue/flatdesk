// Tidying tags across the whole team: rename one (or fold it into another that
// exists), or take it off every ticket. Macros, assignment rules and saved
// views that name the tag follow a rename.

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeTags } from "@/lib/tickets";

const { tickets, macros, rules, savedViews } = schema;

export class TagError extends Error {}

const clean = (raw: string) => normalizeTags([raw])[0] ?? "";

export async function tagCounts(orgId: string): Promise<{ tag: string; tickets: number }[]> {
  const rows = await db.execute<{ tag: string; n: number }>(sql`
    select tag, count(*)::int as n from (select unnest(${tickets.tags}) as tag from ${tickets} where ${tickets.orgId} = ${orgId} and ${tickets.deletedAt} is null) t
    group by tag order by n desc, tag asc limit 500`);
  return rows.rows.map((r) => ({ tag: r.tag, tickets: Number(r.n) }));
}

// Returns how many tickets changed.
export async function renameTag(orgId: string, fromRaw: string, toRaw: string): Promise<number> {
  const from = clean(fromRaw);
  const to = clean(toRaw);
  if (!from || !to) throw new TagError("Enter the tag's new name.");
  if (from === to) throw new TagError("That's already its name.");
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      update ${tickets} set tags = (select coalesce(array_agg(distinct x), '{}') from unnest(array_replace(${tickets.tags}, ${from}, ${to})) x), updated_at = updated_at
      where ${tickets.orgId} = ${orgId} and ${tickets.tags} @> array[${from}]::text[]`);
    await tx.execute(sql`update ${macros} set add_tags = (select coalesce(array_agg(distinct x), '{}') from unnest(array_replace(${macros.addTags}, ${from}, ${to})) x) where ${macros.orgId} = ${orgId} and ${macros.addTags} @> array[${from}]::text[]`);
    // A rule can't have the same tag and person twice, so a rename that would collide drops the old one.
    await tx.execute(sql`delete from ${rules} r where r.org_id = ${orgId} and r.if_tag = ${from} and exists (select 1 from ${rules} o where o.org_id = r.org_id and o.if_tag = ${to} and o.assign_to = r.assign_to)`);
    await tx.update(rules).set({ ifTag: to }).where(and(eq(rules.orgId, orgId), eq(rules.ifTag, from)));
    await tx.execute(sql`update ${savedViews} set filters = jsonb_set(filters, '{tags}', (select coalesce(jsonb_agg(distinct case when v = ${from} then ${to} else v end), '[]'::jsonb) from jsonb_array_elements_text(filters->'tags') v)) where ${savedViews.orgId} = ${orgId} and filters->'tags' ? ${from}`);
    return res.rowCount ?? 0;
  });
}

export async function deleteTag(orgId: string, raw: string): Promise<number> {
  const tag = clean(raw);
  if (!tag) throw new TagError("Pick a tag.");
  const res = await db.execute(sql`update ${tickets} set tags = array_remove(${tickets.tags}, ${tag}), updated_at = updated_at where ${tickets.orgId} = ${orgId} and ${tickets.tags} @> array[${tag}]::text[]`);
  await db.execute(sql`update ${macros} set add_tags = array_remove(${macros.addTags}, ${tag}) where ${macros.orgId} = ${orgId} and ${macros.addTags} @> array[${tag}]::text[]`);
  return res.rowCount ?? 0;
}
