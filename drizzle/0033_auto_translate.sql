ALTER TYPE "public"."copilot_kind" ADD VALUE 'translate';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "translation" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "translated_from" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "original" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;