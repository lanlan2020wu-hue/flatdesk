ALTER TABLE "tickets" ADD COLUMN "needs_team_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tickets_org_needs_team" ON "tickets" USING btree ("org_id","needs_team_at");--> statement-breakpoint
-- When a ticket was last given to someone, however it was assigned. Imported
-- tickets arrive already assigned, which isn't news to anyone.
CREATE OR REPLACE FUNCTION flatdesk_ticket_assigned() RETURNS trigger AS $$
BEGIN
  IF NEW.assignee_id IS NULL THEN
    NEW.assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.source IS NULL THEN NEW.assigned_at := now(); END IF;
  ELSIF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tickets_assigned BEFORE INSERT OR UPDATE OF assignee_id ON tickets FOR EACH ROW EXECUTE FUNCTION flatdesk_ticket_assigned();
