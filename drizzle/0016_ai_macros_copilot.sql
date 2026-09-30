CREATE TYPE "public"."copilot_kind" AS ENUM('summary', 'draft', 'rewrite');--> statement-breakpoint
CREATE TABLE "copilot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid,
	"user_id" text NOT NULL,
	"kind" "copilot_kind" NOT NULL,
	"month" text NOT NULL,
	"last_message_id" uuid,
	"output" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_ai_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"question" text NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "macros" ADD COLUMN "question" text;--> statement-breakpoint
ALTER TABLE "copilot_events" ADD CONSTRAINT "copilot_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_events" ADD CONSTRAINT "copilot_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_ai_drafts" ADD CONSTRAINT "macro_ai_drafts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_events_org_month" ON "copilot_events" USING btree ("org_id","month");--> statement-breakpoint
CREATE INDEX "copilot_events_ticket" ON "copilot_events" USING btree ("ticket_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_ai_drafts_org_key" ON "macro_ai_drafts" USING btree ("org_id","key");
