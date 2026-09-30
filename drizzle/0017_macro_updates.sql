CREATE TABLE "macro_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"macro_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"macro_body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_update_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"macro_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "macro_uses" ADD CONSTRAINT "macro_uses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_uses" ADD CONSTRAINT "macro_uses_macro_id_macros_id_fk" FOREIGN KEY ("macro_id") REFERENCES "public"."macros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_uses" ADD CONSTRAINT "macro_uses_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_update_dismissals" ADD CONSTRAINT "macro_update_dismissals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_update_dismissals" ADD CONSTRAINT "macro_update_dismissals_macro_id_macros_id_fk" FOREIGN KEY ("macro_id") REFERENCES "public"."macros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "macro_uses_org_macro" ON "macro_uses" USING btree ("org_id","macro_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_update_dismissals_macro_sig" ON "macro_update_dismissals" USING btree ("macro_id","signature");
