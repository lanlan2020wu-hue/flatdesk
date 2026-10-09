CREATE TABLE "ai_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"month" text NOT NULL,
	"applied" jsonb,
	"reason" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "ai_triage" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_triage" ADD CONSTRAINT "ai_triage_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_triage" ADD CONSTRAINT "ai_triage_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_triage_ticket" ON "ai_triage" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ai_triage_org_month" ON "ai_triage" USING btree ("org_id","month");