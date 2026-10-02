ALTER TABLE "orgs" ALTER COLUMN "inbound_key" SET DEFAULT substr(md5(gen_random_uuid()::text), 1, 12);--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "widget_key" SET DEFAULT substr(md5(gen_random_uuid()::text), 1, 16);--> statement-breakpoint
-- Help center addresses used to be the team name, then name-2, name-3 for
-- teams with the same name. Teams that share a name and still have one of
-- those automatic addresses get the name plus a random tag instead, like new
-- teams do (lib/help.ts ensureHelpSlug). Addresses an admin typed themselves
-- are left alone.
WITH named AS (
	SELECT id, help_slug, trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) AS s
	FROM orgs
	WHERE help_slug IS NOT NULL
), base AS (
	SELECT id, help_slug,
		CASE WHEN length(b) < 3 THEN b || '-help' ELSE b END AS auto
	FROM (SELECT id, help_slug, rtrim(left(CASE WHEN s = '' THEN 'help' ELSE s END, 36), '-') AS b FROM named) x
), auto AS (
	SELECT id, auto FROM base WHERE help_slug = auto OR help_slug ~ ('^' || auto || '-[0-9]+$')
), shared AS (
	SELECT auto FROM auto GROUP BY auto HAVING count(*) > 1
)
UPDATE orgs
SET help_slug = rtrim(left(auto.auto, 30), '-') || '-' || substr(md5(gen_random_uuid()::text), 1, 6)
FROM auto
WHERE orgs.id = auto.id AND auto.auto IN (SELECT auto FROM shared);
