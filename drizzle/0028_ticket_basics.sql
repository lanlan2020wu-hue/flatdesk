CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TABLE "ticket_presence" (
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"typing" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "priority" "ticket_priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_presence" ADD CONSTRAINT "ticket_presence_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_presence" ADD CONSTRAINT "ticket_presence_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_presence_ticket_user" ON "ticket_presence" USING btree ("ticket_id","user_id");--> statement-breakpoint
CREATE INDEX "messages_body_search" ON "messages" USING gin (to_tsvector('simple', "body"));