CREATE INDEX "ai_events_ticket" ON "ai_events" USING btree ("ticket_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "csat_ratings_ticket" ON "csat_ratings" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "messages_agent_replies" ON "messages" USING btree ("org_id","author_id","created_at") WHERE "messages"."author_type" = 'agent' and not "messages"."internal";--> statement-breakpoint
CREATE INDEX "messages_org_agent_created" ON "messages" USING btree ("org_id","created_at" DESC NULLS LAST) WHERE "messages"."author_type" = 'agent' and not "messages"."internal";--> statement-breakpoint
CREATE INDEX "tickets_org_created" ON "tickets" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_org_closed_at" ON "tickets" USING btree ("org_id","closed_at") WHERE "tickets"."status" = 'closed';--> statement-breakpoint
CREATE INDEX "tickets_customer_created" ON "tickets" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_org_updated" ON "tickets" USING btree ("org_id","updated_at") WHERE "tickets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tickets_first_reply_due" ON "tickets" USING btree ("created_at") WHERE "tickets"."status" = 'open' and "tickets"."first_response_at" is null and "tickets"."escalated_at" is null and "tickets"."source" is null;--> statement-breakpoint
CREATE INDEX "tickets_resolve_due" ON "tickets" USING btree ("created_at") WHERE "tickets"."status" <> 'closed' and "tickets"."resolve_escalated_at" is null and "tickets"."source" is null;--> statement-breakpoint
CREATE INDEX "tickets_next_reply_due" ON "tickets" USING btree ("awaiting_since") WHERE "tickets"."status" = 'open' and "tickets"."first_response_at" is not null and "tickets"."source" is null;