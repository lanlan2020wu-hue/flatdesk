CREATE TABLE "triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"match_all" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imported_rules" ADD COLUMN "flatdesk_trigger_id" uuid;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "escalate_to" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "triggers_org_position" ON "triggers" USING btree ("org_id","position");--> statement-breakpoint
ALTER TABLE "imported_rules" ADD CONSTRAINT "imported_rules_flatdesk_trigger_id_triggers_id_fk" FOREIGN KEY ("flatdesk_trigger_id") REFERENCES "public"."triggers"("id") ON DELETE set null ON UPDATE no action;