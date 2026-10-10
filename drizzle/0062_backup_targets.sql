CREATE TABLE "backup_targets" (
	"org_id" text PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"region" text NOT NULL,
	"endpoint" text,
	"prefix" text DEFAULT 'flatdesk/' NOT NULL,
	"credentials" text NOT NULL,
	"include_files" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_ok" boolean,
	"last_key" text,
	"last_bytes" integer,
	"last_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_targets" ADD CONSTRAINT "backup_targets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;