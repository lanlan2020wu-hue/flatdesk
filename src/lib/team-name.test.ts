import assert from "node:assert/strict";
import { test } from "node:test";
import { teamNameFromEmail } from "./team-name";

test("names the team after the company domain", () => {
  assert.equal(teamNameFromEmail("sam@acme.com"), "Acme");
  assert.equal(teamNameFromEmail("sam@support.acme-labs.io"), "Acme Labs");
  assert.equal(teamNameFromEmail("sam@acme.co.uk"), "Acme");
});

test("leaves the name blank for personal mailboxes and missing emails", () => {
  assert.equal(teamNameFromEmail("sam@gmail.com"), "");
  assert.equal(teamNameFromEmail("sam@Outlook.com"), "");
  assert.equal(teamNameFromEmail(undefined), "");
  assert.equal(teamNameFromEmail("not-an-email"), "");
});
