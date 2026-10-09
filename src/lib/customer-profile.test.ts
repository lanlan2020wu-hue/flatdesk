import assert from "node:assert/strict";
import { test } from "node:test";
import { CUSTOMER_NOTES_MAX, cleanCustomerNotes, CustomerProfileError } from "./customer-profile";

test("notes keep their lines but lose stray spaces, NUL bytes and Windows line endings", () => {
  assert.equal(cleanCustomerNotes("  Prefers phone.  \r\nRenews March\t \r\n\n"), "Prefers phone.\nRenews March");
  assert.equal(cleanCustomerNotes("a\0b"), "ab");
  assert.equal(cleanCustomerNotes(null), "");
  assert.equal(cleanCustomerNotes(undefined), "");
});

test("notes over the limit are refused with the count, not cut off", () => {
  assert.equal(cleanCustomerNotes("x".repeat(CUSTOMER_NOTES_MAX)).length, CUSTOMER_NOTES_MAX);
  assert.throws(() => cleanCustomerNotes("x".repeat(CUSTOMER_NOTES_MAX + 1)), (e: unknown) => e instanceof CustomerProfileError && /2001/.test(e.message));
});
