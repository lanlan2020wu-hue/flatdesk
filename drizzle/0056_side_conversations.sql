CREATE TABLE "side_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"token" text NOT NULL,
	"to_email" text NOT NULL,
	"to_name" text,
	"subject" text NOT NULL,
	"created_by" text NOT NULL,
	"closed_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "side_id" uuid;--> statement-breakpoint
ALTER TABLE "side_conversations" ADD CONSTRAINT "side_conversations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_conversations" ADD CONSTRAINT "side_conversations_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "side_conversations_token" ON "side_conversations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "side_conversations_ticket" ON "side_conversations" USING btree ("ticket_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_side_id_side_conversations_id_fk" FOREIGN KEY ("side_id") REFERENCES "public"."side_conversations"("id") ON DELETE cascade ON UPDATE no action;