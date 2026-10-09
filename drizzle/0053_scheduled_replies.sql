CREATE TYPE "public"."scheduled_reply_status" AS ENUM('scheduled', 'sent', 'held', 'cancelled');--> statement-breakpoint
CREATE TABLE "scheduled_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"original" text,
	"status" "scheduled_reply_status" DEFAULT 'scheduled' NOT NULL,
	"next_status" "ticket_status" DEFAULT 'pending' NOT NULL,
	"add_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"assign_to" text,
	"macro_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"held_reason" text,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_replies" ADD CONSTRAINT "scheduled_replies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_replies" ADD CONSTRAINT "scheduled_replies_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_replies_due" ON "scheduled_replies" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "scheduled_replies_ticket" ON "scheduled_replies" USING btree ("ticket_id");