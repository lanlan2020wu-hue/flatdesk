CREATE TYPE "public"."ai_learning_kind" AS ENUM('run', 'added', 'updated', 'retired', 'flagged', 'removed');--> statement-breakpoint
CREATE TABLE "ai_learning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"kind" "ai_learning_kind" NOT NULL,
	"macro_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"ticket_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"model" text,
	"cost_usd" numeric(10, 5) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "ai_auto_learn" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_learning" ADD CONSTRAINT "ai_learning_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_learning" ADD CONSTRAINT "ai_learning_macro_id_macros_id_fk" FOREIGN KEY ("macro_id") REFERENCES "public"."macros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_learning_org_created" ON "ai_learning" USING btree ("org_id","created_at");