ALTER TABLE "orgs" ADD COLUMN "resolve_minutes" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "resolve_escalated_at" timestamp with time zone;