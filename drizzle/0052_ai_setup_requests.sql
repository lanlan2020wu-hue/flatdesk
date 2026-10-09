CREATE TABLE "ai_setup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"company" text,
	"agents" integer,
	"monthly_tickets" integer,
	"current_tool" text,
	"message" text,
	"source" text,
	"referrer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
