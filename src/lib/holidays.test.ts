import assert from "node:assert/strict";
import { test } from "node:test";
import { dueAt, isOpenNow, parseHolidays, validHours } from "./sla";

const ny = { tz: "America/New_York", days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60, holidays: ["2026-12-25"] };

test("dates are read from lines, spaces or commas; bad ones are returned", () => {
  assert.deepEqual(parseHolidays("2026-12-25\n2026-01-01, 2026-12-25"), { list: ["2026-01-01", "2026-12-25"], rejected: [] });
  assert.deepEqual(parseHolidays("2026-02-30 12/25/2026 2026-13-01").rejected, ["2026-02-30", "12/25/2026", "2026-13-01"]);
  assert.deepEqual(parseHolidays(""), { list: [], rejected: [] });
  assert.equal(parseHolidays(Array.from({ length: 100 }, (_, i) => `2027-01-${String((i % 28) + 1).padStart(2, "0")}-x`).join(" ")).list.length, 0);
});

test("a holiday counts as closed all day, in the team's time zone", () => {
  // Friday 25 Dec 2026, noon in New York.
  assert.equal(isOpenNow(ny, new Date("2026-12-25T17:00:00Z")), false);
  assert.equal(isOpenNow({ ...ny, holidays: [] }, new Date("2026-12-25T17:00:00Z")), true);
  assert.equal(isOpenNow(ny, new Date("2026-12-24T17:00:00Z")), true);
  // 2am UTC on the 26th is still the evening of the 25th in New York.
  assert.equal(isOpenNow({ ...ny, days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440 }, new Date("2026-12-26T02:00:00Z")), false);
});

test("targets skip holidays", () => {
  // Thursday 24 Dec 4 PM New York, 2 hours: 1 hour left Thursday, then Monday 28th from 9 AM (Friday is a holiday).
  assert.equal(dueAt(new Date("2026-12-24T21:00:00Z"), 120, ny).toISOString(), "2026-12-28T15:00:00.000Z");
  assert.equal(dueAt(new Date("2026-12-24T21:00:00Z"), 120, { ...ny, holidays: [] }).toISOString(), "2026-12-25T15:00:00.000Z");
  assert.ok(validHours(ny));
});
