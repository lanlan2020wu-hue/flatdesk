ALTER TABLE "agents" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "account_key" text;--> statement-breakpoint
ALTER TABLE "macros" ADD COLUMN "internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Duplicates made before these indexes existed. Nothing is lost: identical
-- rules collapse to one (imported rules point at the one kept), extra copies
-- of an imported macro keep their text but stop claiming the source id, and a
-- second import that was running at once for a team is marked failed.
UPDATE "imported_rules" ir SET "flatdesk_rule_id" = k."keep"
FROM (
  SELECT "id", first_value("id") OVER (PARTITION BY "org_id", "if_tag", "assign_to" ORDER BY "enabled" DESC, "created_at", "id") AS "keep"
  FROM "rules"
) k
WHERE ir."flatdesk_rule_id" = k."id" AND k."id" <> k."keep";--> statement-breakpoint
DELETE FROM "rules" r USING (
  SELECT "id", first_value("id") OVER (PARTITION BY "org_id", "if_tag", "assign_to" ORDER BY "enabled" DESC, "created_at", "id") AS "keep"
  FROM "rules"
) k
WHERE r."id" = k."id" AND k."id" <> k."keep";--> statement-breakpoint
UPDATE "macros" m SET "external_id" = NULL FROM (
  SELECT "id", row_number() OVER (PARTITION BY "org_id", "source", "external_id" ORDER BY "created_at", "id") AS "n"
  FROM "macros" WHERE "external_id" IS NOT NULL
) d
WHERE m."id" = d."id" AND d."n" > 1;--> statement-breakpoint
UPDATE "imports" i SET "status" = 'failed', "error" = 'Stopped because another import for this team was running at the same time.', "credentials" = NULL, "finished_at" = now()
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "org_id" ORDER BY "created_at", "id") AS "n"
  FROM "imports" WHERE "status" = 'running'
) d
WHERE i."id" = d."id" AND d."n" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "imports_org_running" ON "imports" USING btree ("org_id") WHERE "imports"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "macros_org_source_external" ON "macros" USING btree ("org_id","source","external_id") WHERE "macros"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "rules_org_tag_assignee" ON "rules" USING btree ("org_id","if_tag","assign_to");