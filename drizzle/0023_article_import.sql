ALTER TABLE "articles" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_org_source_external" ON "articles" USING btree ("org_id","source","external_id") WHERE "articles"."external_id" is not null;