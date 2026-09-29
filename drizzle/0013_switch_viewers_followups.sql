ALTER TYPE "public"."ai_event_kind" ADD VALUE 'followup';--> statement-breakpoint
DROP INDEX "messages_org_email_message_id";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "viewer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "trial_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
-- Keep the earliest copy of any email delivered twice; later copies lose only the header id.
UPDATE "messages" SET "email_message_id" = NULL WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "org_id", "email_message_id" ORDER BY "created_at", "id") AS n
    FROM "messages" WHERE "email_message_id" IS NOT NULL
  ) d WHERE d.n > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_email_message_id" ON "messages" USING btree ("org_id","email_message_id") WHERE "messages"."email_message_id" is not null;