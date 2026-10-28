import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../src/discount.mjs";

test("a zero percent discount preserves the price", () => {
  assert.equal(applyDiscount(100, 0), 100);
});

test("a discount on zero remains zero", () => {
  assert.equal(applyDiscount(0, 20), 0);
});
