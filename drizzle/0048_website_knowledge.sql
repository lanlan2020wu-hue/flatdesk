CREATE TYPE "public"."web_source_status" AS ENUM('reading', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "web_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"status" "web_source_status" DEFAULT 'reading' NOT NULL,
	"error" text,
	"page_count" integer DEFAULT 0 NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_pages" ADD CONSTRAINT "web_pages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_pages" ADD CONSTRAINT "web_pages_source_id_web_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."web_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_sources" ADD CONSTRAINT "web_sources_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_pages_source_url" ON "web_pages" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "web_pages_org" ON "web_pages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_sources_org_url" ON "web_sources" USING btree ("org_id","url");