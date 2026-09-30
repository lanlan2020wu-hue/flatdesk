import assert from "node:assert/strict";
import { test } from "node:test";
import { ADDONS, FLATDESK_ADDON } from "@/lib/ai-addons";

test("every add-on row has a price and a source", () => {
  assert.equal(FLATDESK_ADDON.perAgent, null);
  for (const a of ADDONS) {
    assert.ok(a.perAgent !== null && a.perAgent > 0, a.vendor);
    assert.ok(a.sources.length > 0, a.vendor);
  }
  // Help Scout's step comes from the calculator's Standard and Plus seats.
  assert.equal(ADDONS.find((a) => a.vendor === "Help Scout")?.perAgent, 20);
});
