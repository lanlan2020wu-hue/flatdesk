CREATE TYPE "public"."csat_rating" AS ENUM('great', 'okay', 'bad');--> statement-breakpoint
CREATE TABLE "csat_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"rating" "csat_rating" NOT NULL,
	"rated_author_type" "author_type" NOT NULL,
	"agent_id" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "alert_webhook_url" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "alert_on" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "alert_secret" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "alert_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "alert_last_error" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "csat_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "first_response_minutes" integer DEFAULT 240;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "business_hours" jsonb;--> statement-breakpoint
ALTER TABLE "csat_ratings" ADD CONSTRAINT "csat_ratings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_ratings" ADD CONSTRAINT "csat_ratings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csat_ratings" ADD CONSTRAINT "csat_ratings_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "csat_ratings_message" ON "csat_ratings" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "csat_ratings_org_created" ON "csat_ratings" USING btree ("org_id","created_at");