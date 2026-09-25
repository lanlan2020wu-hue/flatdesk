ALTER TABLE "orgs" ADD COLUMN "widget_key" text DEFAULT substr(md5(random()::text), 1, 12) NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "visitor_token" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_widget_key_unique" UNIQUE("widget_key");