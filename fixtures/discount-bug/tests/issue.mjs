import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../src/discount.mjs";

test("a 20 percent discount reduces 100 to 80", () => {
  assert.equal(applyDiscount(100, 20), 80);
});
