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
