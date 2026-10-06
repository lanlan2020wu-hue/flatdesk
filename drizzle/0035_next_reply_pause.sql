ALTER TABLE "orgs" ADD COLUMN "next_reply_minutes" integer;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "pause_while_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "awaiting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "next_escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "paused_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Time spent pending, counted on every status change however it's made.
CREATE OR REPLACE FUNCTION flatdesk_ticket_pending() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN NEW.pending_since := coalesce(NEW.pending_since, now()); END IF;
  ELSIF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
    NEW.pending_since := now();
  ELSIF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    NEW.paused_seconds := OLD.paused_seconds + greatest(0, floor(extract(epoch from now() - coalesce(OLD.pending_since, now()))))::integer;
    NEW.pending_since := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tickets_pending BEFORE INSERT OR UPDATE OF status ON tickets FOR EACH ROW EXECUTE FUNCTION flatdesk_ticket_pending();
--> statement-breakpoint
-- When the customer is waiting on a reply: their message after the team's
-- first reply starts the wait, a reply (agent or AI) ends it. Notes don't count.
CREATE OR REPLACE FUNCTION flatdesk_message_wait() RETURNS trigger AS $$
BEGIN
  IF NEW.internal THEN RETURN NEW; END IF;
  IF NEW.author_type = 'customer' THEN
    UPDATE tickets SET awaiting_since = coalesce(awaiting_since, NEW.created_at) WHERE id = NEW.ticket_id AND first_response_at IS NOT NULL AND source IS NULL;
  ELSIF NEW.author_type IN ('agent', 'ai') THEN
    UPDATE tickets SET awaiting_since = NULL WHERE id = NEW.ticket_id AND awaiting_since IS NOT NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER messages_wait AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION flatdesk_message_wait();
--> statement-breakpoint
UPDATE tickets SET pending_since = updated_at WHERE status = 'pending';
