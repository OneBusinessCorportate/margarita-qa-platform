import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/users";

test("hashPassword produces a verifiable scrypt hash", () => {
  const stored = hashPassword("s3cret-pass");
  assert.match(stored, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.ok(verifyPassword("s3cret-pass", stored));
});

test("verifyPassword rejects wrong password", () => {
  const stored = hashPassword("correct-horse");
  assert.equal(verifyPassword("battery-staple", stored), false);
});

test("verifyPassword rejects malformed stored value", () => {
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  assert.equal(verifyPassword("x", "scrypt$only-two"), false);
});

test("each hash uses a fresh salt", () => {
  const a = hashPassword("same");
  const b = hashPassword("same");
  assert.notEqual(a, b);
  assert.ok(verifyPassword("same", a));
  assert.ok(verifyPassword("same", b));
});
