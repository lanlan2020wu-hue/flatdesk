ALTER TABLE "orgs" ADD COLUMN "alert_events" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "update_every_hours" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "update_due_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tickets_update_due" ON "tickets" USING btree ("update_due_at") WHERE "tickets"."update_due_at" is not null;