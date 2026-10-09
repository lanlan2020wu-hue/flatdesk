CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "domain" text GENERATED ALWAYS AS (lower(split_part(email, '@', 2))) STORED;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_domain" ON "companies" USING btree ("org_id","domain");--> statement-breakpoint
CREATE INDEX "customers_org_domain" ON "customers" USING btree ("org_id","domain");