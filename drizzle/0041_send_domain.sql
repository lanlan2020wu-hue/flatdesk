ALTER TABLE "orgs" ADD COLUMN "send_address" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "send_domain" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "send_domain_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "send_domain_records" jsonb;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "send_domain_added_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "send_domain_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_send_domain_unique" UNIQUE("send_domain");