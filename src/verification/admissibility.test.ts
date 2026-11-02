import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fixtureDigests } from "../sandbox/fixture";
import { admitDiscount } from "./admissibility";

// All candidates below are inert strings. Nothing imports, evaluates or runs them.
const imports = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { applyDiscount } from "../src/discount.mjs";\n';
const body = 'assert.equal(applyDiscount(100, 20), 80);';
const test = (statements: string) => `${imports}test("discount", () => { ${statements} });`;
const bytes = (text: string) => Buffer.from(text);
const source = (expression: string) => `export function applyDiscount(price, percentage) { return ${expression}; }`;

describe("owned discount AST admission (static only)", () => {
  it("reads exact manifest/source/test bytes and accepts the pinned fixture without executing it", async () => {
    const root = "fixtures/discount-bug/";
    const manifest = JSON.parse(await readFile(root + "manifest.json", "utf8"));
    expect(manifest.pinnedBaseSha).toBe("1066351c5b07bed024775a16af9151048a9316b2");
    for (const [path, hash] of Object.entries(fixtureDigests)) {
      const content = await readFile(root + path);
      expect(createHash("sha256").update(content).digest("hex")).toBe(hash);
      expect(manifest.sha256[path]).toBe(hash);
      expect(admitDiscount(content, path.startsWith("src/") ? "source" : path.includes("regression") ? "regressions" : "issue"))
        .toMatchObject({ status: "ADMISSIBLE", sha256: hash });
    }
  });
  it.each([
    source("price - (price * percentage) / 100"),
    source("price === 0 ? 0 : (price - price * percentage / 100)"),
    'export function applyDiscount(price: number, percentage: number): number { const amount: number = price * percentage / 100; return price - amount; }',
    source("(price >= 0 && percentage !== 0) ? price % 100 : -price"),
  ])("supports bounded numeric JS/TS expressions: %s", candidate => {
    expect(admitDiscount(bytes(candidate), "source", "typescript").status).toBe("ADMISSIBLE");
  });
  it("accepts direct asserting tests, numeric constants and harmless comments", () => {
    const candidate = test('const price: number = 100; const percent = 20; /* eval in comment is data */ assert.strictEqual(applyDiscount(price, percent), 80);');
    expect(admitDiscount(bytes(candidate), "issue", "typescript")).toMatchObject({ status: "ADMISSIBLE", tests: 1, assertions: 1 });
    expect(admitDiscount(bytes(test(body + body)), "issue")).toMatchObject({ tests: 1, assertions: 2 });
  });
  it.each([
    'eval("process.exit()")', 'Function("return process")()', 'new Function("return 1")()',
    'globalThis.process.exit()', 'process.exit()', 'import("node:fs")', 'require("node:fs")',
    'price["constructor"]', 'price.constructor', 'price?.constructor', '({}).constructor',
    '(price = 0)', 'percentage++', '(delete price.x)', 'this', 'arguments[0]',
    '(() => { globalThis.x = 1; return 0; })()', '(0, eval)("0")',
    'price || globalThis.process.exit()', 'true ? 0 : eval("0")',
    'price === 1 ? price : ({ get x() { return 0; } }).x',
    '(price as number)', 'price!', 'String.raw`hello`', '[...price]', 'Math.max(price, 0)',
    'Number(price)', 'applyDiscount(price, percentage)', 'undefined', 'NaN', 'Infinity',
    'price ** 1000000', 'price instanceof Object', 'price in {}', '1e999',
  ])("rejects nested/unknown/unsafe source expression: %s", expression => {
    expect(admitDiscount(bytes(source(expression)), "source", "typescript").status).toBe("REJECTED");
  });
  it.each([
    'import fs from "node:fs"; ', 'export * from "node:fs"; ', 'globalThis.x = 1; ',
    'const alias = eval; ', 'export const x = 0; ', 'class Evil {} ',
    'declare global { interface Object { unsafe: string } } ',
    'namespace X { export const value = process.exit(); } ',
  ])("rejects extra source statements: %s", prefix => {
    expect(admitDiscount(bytes(prefix + source("price")), "source", "typescript").status).toBe("REJECTED");
  });
  it.each([
    'export function applyDiscount(price = process.exit(), percentage) { return price; }',
    'export async function applyDiscount(price, percentage) { return price; }',
    'export function* applyDiscount(price, percentage) { return price; }',
    'export function applyDiscount(price, percentage) { while (true) {} return price; }',
    'export function applyDiscount(price, percentage) { try { return price; } catch {} }',
    'export function applyDiscount(price, percentage) { const alias = price.constructor; return price; }',
    'export function applyDiscount(price, percentage) { const a = a; return a; }',
    'export function applyDiscount(price, percentage) { const price = 1; return price; }',
    'export function applyDiscount(price: Evil, percentage: number): number { return price; }',
    'export function applyDiscount(pr\\u0069ce, percentage) { return 0; }',
    'export function applyDiscount(price, percentage) { const test = 1; return test; }',
    'export function applyDiscount(price, percentage) { "use strict"; return price; }',
  ])("rejects binding/statement/type bypass: %s", candidate => {
    expect(admitDiscount(bytes(candidate), "source", "typescript").status).toBe("REJECTED");
  });
  it.each([
    '', 'const x = 1;', 'applyDiscount(100, 20);', 'assert.equal(80, 80);',
    'if (false) { assert.equal(applyDiscount(100, 20), 80); }',
    'try { assert.equal(applyDiscount(100, 20), 80); } catch {}',
    'return; assert.equal(applyDiscount(100, 20), 80);',
    'const a = assert; a.equal(applyDiscount(100, 20), 80);',
    'const { equal } = assert; equal(applyDiscount(100, 20), 80);',
    'const a = applyDiscount; assert.equal(a(100, 20), 80);',
    'assert["equal"](applyDiscount(100, 20), 80);',
    'assert[`equal`](applyDiscount(100, 20), 80);',
    'assert.equ\\u0061l(applyDiscount(100, 20), 80);',
    'assert.equal.call(null, applyDiscount(100, 20), 80);',
    'assert.equal?.(applyDiscount(100, 20), 80);',
    'assert.equal(applyDiscount["call"](null, 100, 20), 80);',
    'assert.equal(applyDiscount(...[100, 20]), 80);',
    'assert.equal(applyDiscount(100, 20), applyDiscount(100, 20));',
    'assert.equal(applyDiscount(100, 20), 80, process.exit());',
    'assert.equal(applyDiscount((() => { process.exit(); })(), 20), 80);',
    'const x = 1; x.constructor.constructor("return process")().exit();',
    'test("nested", () => { assert.equal(applyDiscount(100, 20), 80); });',
    'globalThis.assert = () => {}; assert.equal(applyDiscount(100, 20), 80);',
    'assert = { equal() {} }; assert.equal(applyDiscount(100, 20), 80);',
  ])("rejects non-asserting and obfuscated test body: %s", statements => {
    expect(admitDiscount(bytes(test(statements)), "issue", "typescript").status).toBe("REJECTED");
  });
  it.each([
    `test.skip("discount", () => { ${body} });`, `test.only("discount", () => { ${body} });`,
    `test.todo("discount");`, `test("discount", { skip: true }, () => { ${body} });`,
    `test("discount", { only: true }, () => { ${body} });`, `test("discount", async () => { ${body} });`,
    `test("discount", t => { t.skip(); ${body} });`, `test("discount", () => ${body.slice(0, -1)});`,
    `test("discount", function() { ${body} });`, `test("discount", () => { ${body} }); ${body}`,
    `test("discount", () => { ${body} }); test("other", () => {});`,
    `test("discount", () => { ${body} }); test("discount", () => { ${body} });`,
    `test("discount", () => { ${body} }); test("other", () => { ${body} });`,
  ])("rejects focused/skipped/multiple/unsupported registration: %s", registration => {
    expect(admitDiscount(bytes(imports + registration), "issue").status).toBe("REJECTED");
  });
  it.each([
    ['"node:test"', '"vitest"'], ['{ test }', '{ test as it }'], ['{ test }', '* as test'],
    ['"node:assert/strict"', '"node:assert"'], ['assert from', '{ equal as assert } from'],
    ['"../src/discount.mjs"', '"../../src/discount.mjs"'], ['{ applyDiscount }', '{ applyDiscount as run }'],
  ])("rejects unauthorized imports and aliases: %s -> %s", (before, after) => {
    expect(admitDiscount(bytes(test(body).replace(before, after)), "issue").status).toBe("REJECTED");
  });
  it("fails closed on invalid bytes, parser errors, excess size/depth and unsupported syntax", () => {
    for (const candidate of [Buffer.from([0xff]), bytes(""), bytes("\0"), bytes("\uFEFF" + test(body)), bytes("x".repeat(24001)), bytes(imports + 'test("oops", () => {'), bytes(source("(".repeat(300) + "price" + ")".repeat(300))), bytes(source("<div/>")), bytes('#!/bin/node\n' + test(body))]) {
      expect(admitDiscount(candidate, "issue").status).toBe("REJECTED");
    }
    expect(admitDiscount(bytes(source("(".repeat(60) + "price" + ")".repeat(60))), "source").status).toBe("REJECTED");
    expect(admitDiscount(bytes(source("price")), "source")).not.toHaveProperty("verdict");
  });
});
