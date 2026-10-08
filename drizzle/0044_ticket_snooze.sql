ALTER TABLE "tickets" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "snoozed_by" text;--> statement-breakpoint
CREATE INDEX "tickets_snoozed_until" ON "tickets" USING btree ("snoozed_until") WHERE "tickets"."snoozed_until" is not null;