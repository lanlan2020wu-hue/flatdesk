CREATE TYPE "public"."import_source" AS ENUM('zendesk', 'intercom', 'freshdesk', 'helpscout');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "external_agents" (
	"org_id" text NOT NULL,
	"source" "import_source" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" text,
	"active" boolean DEFAULT true NOT NULL,
	"linked_user_id" text,
	CONSTRAINT "external_agents_org_id_source_external_id_pk" PRIMARY KEY("org_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"org_id" text NOT NULL,
	"source" "import_source" NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"import_id" uuid NOT NULL,
	"label" text,
	"mapped_id" text,
	"issues" text[] DEFAULT '{}'::text[] NOT NULL,
	"raw" jsonb NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_records_org_id_source_kind_external_id_pk" PRIMARY KEY("org_id","source","kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "imported_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source" "import_source" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"active_in_source" boolean DEFAULT true NOT NULL,
	"summary" text[] DEFAULT '{}'::text[] NOT NULL,
	"flatdesk_rule_id" uuid,
	"pending_tag" text,
	"pending_assignee_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source" "import_source" NOT NULL,
	"account" text NOT NULL,
	"status" "import_status" DEFAULT 'running' NOT NULL,
	"phase" text NOT NULL,
	"cursor" jsonb,
	"credentials" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"retry_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"started_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "macros" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "macros" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "macros" ADD COLUMN "not_applied" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "author_email" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "support_email" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "onboarding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "pending_assignee_email" text;--> statement-breakpoint
ALTER TABLE "external_agents" ADD CONSTRAINT "external_agents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_rules" ADD CONSTRAINT "imported_rules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_rules" ADD CONSTRAINT "imported_rules_flatdesk_rule_id_rules_id_fk" FOREIGN KEY ("flatdesk_rule_id") REFERENCES "public"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_agents_email" ON "external_agents" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "import_records_import" ON "import_records" USING btree ("import_id","kind");--> statement-breakpoint
CREATE INDEX "import_records_pending" ON "import_records" USING btree ("import_id","pending");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_rules_org_source_ext" ON "imported_rules" USING btree ("org_id","source","external_id");--> statement-breakpoint
CREATE INDEX "imports_org_created" ON "imports" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_ticket_external" ON "messages" USING btree ("ticket_id","external_id");