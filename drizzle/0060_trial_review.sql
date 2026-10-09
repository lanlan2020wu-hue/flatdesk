ALTER TABLE "orgs" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "review_rating" integer;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "review_text" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "review_public" boolean DEFAULT false NOT NULL;