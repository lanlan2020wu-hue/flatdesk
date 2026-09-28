CREATE TABLE "macro_suggestion_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"text" text NOT NULL,
	"dismissed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "macro_suggestion_dismissals" ADD CONSTRAINT "macro_suggestion_dismissals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "macro_suggestion_dismissals_org" ON "macro_suggestion_dismissals" USING btree ("org_id");