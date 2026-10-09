ALTER TABLE "customers" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "vip" boolean DEFAULT false NOT NULL;