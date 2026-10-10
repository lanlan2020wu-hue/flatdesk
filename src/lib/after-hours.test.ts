import assert from "node:assert/strict";
import { test } from "node:test";
import { AFTER_HOURS_MAX, cleanAfterHoursMessage } from "./after-hours";
import { isOpenNow } from "./sla";

const hours = { tz: "America/New_York", days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 };

test("open on a weekday morning, closed at night and on weekends, in the team's own time zone", () => {
  assert.equal(isOpenNow(hours, new Date("2026-10-07T15:00:00Z")), true); // Wed 11:00 New York
  assert.equal(isOpenNow(hours, new Date("2026-10-07T23:00:00Z")), false); // Wed 19:00
  assert.equal(isOpenNow(hours, new Date("2026-10-07T12:59:00Z")), false); // Wed 08:59
  assert.equal(isOpenNow(hours, new Date("2026-10-10T15:00:00Z")), false); // Saturday
});

test("with no business hours the team counts as always open", () => {
  assert.equal(isOpenNow(null, new Date("2026-10-10T03:00:00Z")), true);
});

test("the message is tidied and capped", () => {
  assert.equal(cleanAfterHoursMessage("  Back at 9.\r\nThanks  "), "Back at 9.\nThanks");
  assert.equal(cleanAfterHoursMessage(null), "");
  assert.equal(cleanAfterHoursMessage("x".repeat(AFTER_HOURS_MAX + 50)).length, AFTER_HOURS_MAX);
});

test("{{number}} in an acknowledgement becomes the ticket number", async () => {
  const { ackText } = await import("./after-hours");
  assert.equal(ackText("Opened ticket #{{number}}. Ref {{ number }}.", 1042), "Opened ticket #1042. Ref 1042.");
  assert.equal(ackText("No placeholder", 7), "No placeholder");
});

if (process.env.DATABASE_URL) {
  test("database: new email tickets get the acknowledgement, or the closed message when closed, once", async () => {
    const { eq } = await import("drizzle-orm");
    const { db, schema, pool } = await import("@/db");
    const { createTicket } = await import("./tickets");
    const { sendAfterHoursReply } = await import("./after-hours");
    const ORG = "org_test_ack";
    try {
      await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
      await db.insert(schema.orgs).values({ id: ORG, name: "Ack team", inboundKey: "ackkey000001", widgetKey: "ackwidget0001", aiEnabled: false, ackMessage: "Got it, ticket #{{number}}.", afterHoursMessage: "We're closed." });
      const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@x.test", subject: "Hi", body: "Hello", authorType: "customer" });
      const noon = new Date("2026-10-07T15:00:00Z"); // Wednesday, open
      assert.equal(await sendAfterHoursReply(ORG, t.id, noon), true);
      assert.equal(await sendAfterHoursReply(ORG, t.id, noon), false, "only once");
      const bodies = async (id: string) => (await db.select().from(schema.messages).where(eq(schema.messages.ticketId, id))).filter((m) => m.authorType === "system").map((m) => m.body);
      assert.deepEqual(await bodies(t.id), [`Got it, ticket #${t.number}.`]);

      await db.update(schema.orgs).set({ businessHours: { tz: "America/New_York", days: [1, 2, 3, 4, 5], start: 540, end: 1020 } }).where(eq(schema.orgs.id, ORG));
      const t2 = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@x.test", subject: "Hi again", body: "Hello", authorType: "customer" });
      assert.equal(await sendAfterHoursReply(ORG, t2.id, new Date("2026-10-10T15:00:00Z")), true); // Saturday
      assert.deepEqual(await bodies(t2.id), ["We're closed."]);

      await db.update(schema.orgs).set({ ackMessage: "" }).where(eq(schema.orgs.id, ORG));
      const t3 = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@x.test", subject: "Third", body: "Hello", authorType: "customer" });
      assert.equal(await sendAfterHoursReply(ORG, t3.id, noon), false, "nothing set, nothing sent");
    } finally {
      await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
      await pool.end();
    }
  });
}
