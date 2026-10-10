import assert from "node:assert/strict";
import { test } from "node:test";
import { digestEmail } from "./digest";

const url = "https://flatdesk.test/app/inbox";

test("a quiet day sends nothing", () => {
  assert.equal(digestEmail("Ada Lovelace", { mine: 0, customerWaiting: 0, unassigned: 0, overdue: 0 }, url), null);
});

test("the email says what is waiting, with the right singular and plural", () => {
  const one = digestEmail("Ada Lovelace", { mine: 1, customerWaiting: 1, unassigned: 1, overdue: 0 }, url)!;
  assert.equal(one.subject, "1 customer is waiting on you");
  assert.match(one.text, /^Good morning Ada,/);
  assert.match(one.text, /1 customer is waiting on a reply from you\./);
  assert.match(one.text, /1 open ticket has nobody on it\./);
  const many = digestEmail("Sam", { mine: 4, customerWaiting: 0, unassigned: 2, overdue: 3 }, url)!;
  assert.equal(many.subject, "6 tickets need a look today");
  assert.match(many.text, /2 open tickets have nobody on them\./);
  assert.match(many.text, /3 tickets are overdue\./);
  assert.ok(many.text.includes(url));
});
