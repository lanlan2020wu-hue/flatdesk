CREATE TYPE "public"."ai_action_approval" AS ENUM('always', 'over_limit', 'never');--> statement-breakpoint
CREATE TYPE "public"."ai_action_kind" AS ENUM('webhook', 'stripe_refund', 'stripe_cancel', 'shopify_cancel');--> statement-breakpoint
CREATE TYPE "public"."ai_action_run_status" AS ENUM('waiting', 'done', 'failed', 'declined');--> statement-breakpoint
CREATE TABLE "ai_action_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"action_id" uuid,
	"kind" "ai_action_kind" NOT NULL,
	"action_name" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"amount_cents" integer,
	"status" "ai_action_run_status" NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"result" text,
	"ai_event_id" uuid,
	"follow_up" boolean DEFAULT false NOT NULL,
	"decided_by" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"kind" "ai_action_kind" NOT NULL,
	"name" text NOT NULL,
	"when_to_use" text DEFAULT '' NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"secret" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL,
	"lookup" boolean DEFAULT false NOT NULL,
	"approval" "ai_action_approval" DEFAULT 'always' NOT NULL,
	"limit_cents" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "ai_reads_records" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_action_runs" ADD CONSTRAINT "ai_action_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_runs" ADD CONSTRAINT "ai_action_runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_runs" ADD CONSTRAINT "ai_action_runs_action_id_ai_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ai_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_action_runs_ticket" ON "ai_action_runs" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ai_action_runs_org_status" ON "ai_action_runs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "ai_actions_org" ON "ai_actions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_actions_org_builtin" ON "ai_actions" USING btree ("org_id","kind") WHERE "ai_actions"."kind" <> 'webhook';