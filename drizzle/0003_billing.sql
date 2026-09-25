ALTER TABLE "orgs" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "billed_seats" integer;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "overage_billed_month" text;