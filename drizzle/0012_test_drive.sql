CREATE TYPE "public"."test_drive_status" AS ENUM('queued', 'running', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."test_drive_verdict" AS ENUM('send', 'edit', 'wrong');--> statement-breakpoint
CREATE TABLE "test_drive_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"status" "test_drive_status" DEFAULT 'queued' NOT NULL,
	"decision" text,
	"draft" text,
	"reason" text,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"model" text,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"verdict" "test_drive_verdict",
	"verdict_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "test_drive_spent_usd" numeric(10, 5) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_drive_drafts" ADD CONSTRAINT "test_drive_drafts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_drive_drafts" ADD CONSTRAINT "test_drive_drafts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "test_drive_drafts_org_ticket" ON "test_drive_drafts" USING btree ("org_id","ticket_id");--> statement-breakpoint
CREATE INDEX "test_drive_drafts_org_status" ON "test_drive_drafts" USING btree ("org_id","status");