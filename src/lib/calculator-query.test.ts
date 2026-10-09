// Shared calculator links. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { CALCULATOR_DEFAULTS, calculatorStart } from "./calculator-query";

test("a shared link opens the calculator with its own numbers", () => {
  assert.deepEqual(calculatorStart({ tool: "freshdesk-growth", agents: "10", resolutions: "1500", billing: "yearly" }), {
    initialTool: "freshdesk-growth",
    initialAgents: 10,
    initialResolutions: 1500,
    initialInterval: "year",
  });
  assert.deepEqual(calculatorStart({ tool: "zendesk-team", agents: "3", resolutions: "0", billing: "monthly" }), {
    initialTool: "zendesk-team",
    initialAgents: 3,
    initialResolutions: 0,
    initialInterval: "month",
  });
});

test("missing or unreadable values keep the defaults", () => {
  assert.deepEqual(calculatorStart({}), CALCULATOR_DEFAULTS);
  assert.deepEqual(calculatorStart({ tool: "", agents: "lots", resolutions: "-5", billing: "weekly" }), CALCULATOR_DEFAULTS);
  assert.equal(calculatorStart({ agents: "" }).initialAgents, CALCULATOR_DEFAULTS.initialAgents);
});

test("a repeated parameter uses its first value", () => {
  assert.equal(calculatorStart({ agents: ["4", "9"] }).initialAgents, 4);
});
