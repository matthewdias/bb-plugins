import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CODE_TTL_MS,
  FAILURE_WINDOW_MS,
  MAX_FAILURES,
  MAX_OUTSTANDING,
  PairingCodes,
} from "../lib/pairing-codes.ts";

test("a code works once", () => {
  const codes = new PairingCodes();
  const { code } = codes.mint(0);
  assert.equal(codes.redeem(code, 1), "ok");
  assert.equal(codes.redeem(code, 2), "invalid");
});

test("a code expires after two minutes", () => {
  const codes = new PairingCodes();
  const { code, expiresAt } = codes.mint(0);
  assert.equal(expiresAt, CODE_TTL_MS);
  assert.equal(codes.redeem(code, CODE_TTL_MS), "invalid");
});

test("a code just inside its lifetime still works", () => {
  const codes = new PairingCodes();
  const { code } = codes.mint(0);
  assert.equal(codes.redeem(code, CODE_TTL_MS - 1), "ok");
});

test("codes are 128 random bits, URL-safe", () => {
  const codes = new PairingCodes();
  const { code } = codes.mint(0);
  assert.match(code, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(codes.mint(0).code, code);
});

test("minting past the limit retires the oldest code", () => {
  const codes = new PairingCodes();
  const first = codes.mint(0).code;
  const rest = Array.from({ length: MAX_OUTSTANDING }, () => codes.mint(0).code);
  assert.equal(codes.redeem(first, 1), "invalid");
  assert.equal(codes.redeem(rest.at(-1)!, 1), "ok");
});

test("repeated wrong codes lock redemption, even for a right one, until the window passes", () => {
  const codes = new PairingCodes();
  const { code } = codes.mint(0);
  for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
    assert.equal(codes.redeem(`wrong-${attempt}`, 1), "invalid");
  }
  assert.equal(codes.redeem(code, 2), "throttled");
  const later = codes.mint(FAILURE_WINDOW_MS + 1).code;
  assert.equal(codes.redeem(later, FAILURE_WINDOW_MS + 2), "ok");
});

test("only a direct loopback request may pair without a link", async () => {
  const { isDirectLoopback } = await import("../lib/pairing-codes.ts");
  assert.equal(isDirectLoopback({ host: "127.0.0.1:38886" }), true);
  assert.equal(isDirectLoopback({ host: "localhost:38886" }), true);
  assert.equal(isDirectLoopback({ host: "[::1]:38886" }), true);
  assert.equal(isDirectLoopback({ host: "mac.tail1234.ts.net" }), false);
  assert.equal(isDirectLoopback({ host: "127.0.0.1:38886", "x-forwarded-for": "100.64.0.2" }), false);
  assert.equal(isDirectLoopback({ host: "127.0.0.1:38886", "tailscale-user-login": "me@example.com" }), false);
  assert.equal(isDirectLoopback({}), false);
});
