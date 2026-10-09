import assert from "node:assert/strict";
import { test } from "node:test";
import { followEmail } from "./followers";

const ticket = { number: 1042, subject: "Where is my order?" };

test("the email says who did what, on which ticket, with the first words and a link", () => {
  const a = followEmail(ticket, { kind: "customer", excerpt: "  Still nothing.  " });
  assert.equal(a.subject, "The customer wrote back on #1042: Where is my order?");
  assert.match(a.text, /Still nothing\./);
  assert.match(a.text, /\/app\/tickets\/1042/);
  assert.equal(followEmail(ticket, { kind: "reply", actor: "Maya" }).subject, "Maya replied on #1042: Where is my order?");
  assert.equal(followEmail(ticket, { kind: "note", actor: "Sam" }).subject, "Sam left a note on #1042: Where is my order?");
});

test("long excerpts and subjects are cut", () => {
  const long = followEmail({ number: 1, subject: "x".repeat(400) }, { kind: "customer", excerpt: "y".repeat(2000) });
  assert.ok(long.subject.length <= 200);
  assert.ok(long.text.length < 800);
});
