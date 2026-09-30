import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES, FLATDESK_ROW, GRID } from "@/lib/ai-addons";

test("every grid row has one cell per feature, and Flatdesk includes them all", () => {
  for (const r of [FLATDESK_ROW, ...GRID]) assert.equal(r.cells.length, FEATURES.length, r.vendor);
  assert.ok(FLATDESK_ROW.cells.every((c) => c !== null));
  assert.equal(FLATDESK_ROW.cells[3], "100 a seat included, then $0.40 each");
  assert.equal(GRID.find((r) => r.vendor === "Help Scout")?.cells[3], "$0.75 each");
  assert.equal(GRID.find((r) => r.vendor === "Freshdesk")?.cells[3], "$0.49 each");
});
