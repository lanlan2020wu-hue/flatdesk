ALTER TYPE "public"."ai_event_kind" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TABLE "ai_events" ADD COLUMN "sources" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "ai_events" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_events" ADD COLUMN "refunded_by" text;--> statement-breakpoint
ALTER TABLE "ai_events" ADD COLUMN "refund_note" text;