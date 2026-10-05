// The free tools' math. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { backlogStaffing, csat, erlangC, formatWallClock, nps, parseWallClock, responsesForMargin, slaAttainment, slaDue, staffing, wilson } from "./support-math";

const near = (a: number, b: number, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("Erlang C matches the textbook case: 10 erlangs, 80% in 20 seconds needs 14 agents", () => {
  // 200 calls an hour at 3 minutes each (Call Centre Helper's worked example).
  const r = staffing({ contactsPerHour: 200, handleSeconds: 180, targetSeconds: 20, targetLevel: 0.8, shrinkage: 0 })!;
  assert.equal(r.traffic, 10);
  assert.equal(r.agents, 14);
  near(r.serviceLevel, 0.887, 0.01);
  near(erlangC(1, 0.5), 0.5, 1e-9); // one server: the chance of waiting is the load
  assert.equal(erlangC(10, 10), 1);
});

test("shrinkage and chat concurrency move the schedule the right way", () => {
  const base = { contactsPerHour: 120, handleSeconds: 480, targetSeconds: 60, targetLevel: 0.8, shrinkage: 0.3 };
  const one = staffing(base)!;
  const three = staffing({ ...base, concurrency: 3 })!;
  assert.ok(three.agents < one.agents);
  assert.equal(one.scheduled, Math.ceil(one.agents / 0.7));
  assert.equal(staffing({ ...base, contactsPerHour: 0 }), null);
});

test("backlog staffing divides work hours by each agent's productive hours", () => {
  const r = backlogStaffing({ ticketsPerDay: 300, minutesPerTicket: 6, hoursPerShift: 8, shrinkage: 0.25 })!;
  assert.equal(r.workHours, 30);
  assert.equal(r.perAgentHours, 6);
  assert.equal(r.agents, 5);
});

test("SLA clock pauses outside business hours and skips weekends", () => {
  const hours = { open: 9 * 60, close: 17 * 60, days: [false, true, true, true, true, true, false] };
  // Friday 2026-10-09 16:00 + 4 business hours = Monday 2026-10-12 12:00.
  assert.equal(formatWallClock(slaDue(parseWallClock("2026-10-09T16:00")!, 240, hours)!), "2026-10-12T12:00");
  // Received before opening: the clock starts at 9.
  assert.equal(formatWallClock(slaDue(parseWallClock("2026-10-06T07:30")!, 60, hours)!), "2026-10-06T10:00");
  // Ends exactly at closing time on the same day.
  assert.equal(formatWallClock(slaDue(parseWallClock("2026-10-06T09:00")!, 480, hours)!), "2026-10-06T17:00");
  // 24/7 just adds.
  assert.equal(formatWallClock(slaDue(parseWallClock("2026-10-09T23:00")!, 120, { ...hours, allHours: true })!), "2026-10-10T01:00");
  assert.equal(slaDue(0, 60, { ...hours, days: hours.days.map(() => false) }), null);
});

test("SLA attainment counts how many more misses fit under the target", () => {
  const r = slaAttainment(200, 6, 0.95)!;
  near(r.rate, 0.97);
  assert.equal(r.missesLeft, 4);
  assert.equal(slaAttainment(10, 11, 0.9), null);
});

test("CSAT, NPS and their margins", () => {
  const c = csat([2, 3, 5, 40, 50])!;
  assert.equal(c.total, 100);
  near(c.score, 0.9);
  near(c.average, 4.33);
  assert.ok(c.interval.low < 0.9 && c.interval.high > 0.9);
  const n = nps(50, 30, 20)!;
  near(n.score, 30, 1e-9);
  near(n.margin, 15.3, 0.2);
  const w = wilson(0, 10)!;
  assert.equal(w.low, 0);
  assert.equal(responsesForMargin(0.05), 385);
});
