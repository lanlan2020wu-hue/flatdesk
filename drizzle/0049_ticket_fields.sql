CREATE TYPE "public"."ticket_field_kind" AS ENUM('text', 'number', 'dropdown', 'checkbox');--> statement-breakpoint
CREATE TABLE "ticket_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "ticket_field_kind" DEFAULT 'text' NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_to_close" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_fields" ADD CONSTRAINT "ticket_fields_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_fields_org_name" ON "ticket_fields" USING btree ("org_id","name");