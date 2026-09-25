ALTER TABLE "orgs" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "ai_instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "ai_notice_month" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "ai_notice_level" integer DEFAULT 0 NOT NULL;