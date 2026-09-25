ALTER TABLE "messages" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "inbound_key" text DEFAULT substr(md5(random()::text), 1, 10) NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_org_email_message_id" ON "messages" USING btree ("org_id","email_message_id");--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_inbound_key_unique" UNIQUE("inbound_key");