ALTER TABLE "tickets" ADD COLUMN "timed_ran" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "timed_skipped" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "timed_skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "event" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "hours" integer;