CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "help_slug" text;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_org_slug" ON "articles" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "articles_org_published" ON "articles" USING btree ("org_id","published");--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_help_slug_unique" UNIQUE("help_slug");