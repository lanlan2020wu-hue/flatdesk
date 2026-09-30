CREATE TABLE "reply_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text,
	"month" text NOT NULL,
	"overall" integer NOT NULL,
	"accuracy" integer NOT NULL,
	"tone" integer NOT NULL,
	"resolution" integer NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"issue" text,
	"note" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reply_reviews" ADD CONSTRAINT "reply_reviews_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_reviews" ADD CONSTRAINT "reply_reviews_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_reviews" ADD CONSTRAINT "reply_reviews_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_reviews_message" ON "reply_reviews" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "reply_reviews_org_month" ON "reply_reviews" USING btree ("org_id","month");
