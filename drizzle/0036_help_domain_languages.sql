CREATE TABLE "article_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"article_id" uuid NOT NULL,
	"language" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"section" text,
	"auto" boolean DEFAULT false NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "help_domain" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "help_domain_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "help_languages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_translations_article_language" ON "article_translations" USING btree ("article_id","language");--> statement-breakpoint
CREATE INDEX "article_translations_org_language" ON "article_translations" USING btree ("org_id","language");--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_help_domain_unique" UNIQUE("help_domain");