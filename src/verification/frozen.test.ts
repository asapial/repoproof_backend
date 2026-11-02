import { describe, expect, it } from "vitest";
import { loadOwnedFixture } from "../sandbox/fixture";
import { freezeDiscountTest, frozenTestsEquivalent, generatedIssuePath, prepareBaseline, prepareDiscountPatch, readSnapshot, sha256, snapshotBytesMatch } from "./frozen";

const fixedSource = Buffer.from('export function applyDiscount(price, percentage) { return price - (price * percentage) / 100; }\n');
const generated = Buffer.from('import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { applyDiscount } from "../src/discount.mjs";\ntest("percentage", () => { assert.equal(applyDiscount(100, 20), 80); });\n');
async function setup() {
  const owned = await loadOwnedFixture(), testBytes = Buffer.from(generated);
  const frozen = freezeDiscountTest(owned, testBytes), baseline = prepareBaseline(frozen);
  const change = { path: "src/discount.mjs", previousSha256: sha256(owned.find(file => file.path === "src/discount.mjs")!.content), content: Buffer.from(fixedSource) };
  return { owned, testBytes, frozen, baseline, change };
}
describe("immutable exact-byte test freeze (no candidate execution)", () => {
  it("seals a deterministic manifest before preparing a source patch", async () => {
    const { owned, frozen, baseline, change } = await setup();
    expect(frozen).toEqual(freezeDiscountTest([...owned].reverse(), generated));
    expect(frozen.manifestSha256).toBe(sha256(Buffer.from(JSON.stringify(frozen.manifest))));
    expect(frozen.manifest.files.find(file => file.path === generatedIssuePath)).toMatchObject({ sha256: sha256(generated), byteLength: generated.length, tests: 1, assertions: 1 });
    const patched = prepareDiscountPatch(frozen, [change]);
    expect(frozenTestsEquivalent(frozen, baseline, patched)).toBe(true);
    expect(patched.snapshotSha256).not.toBe(baseline.snapshotSha256);
    expect(snapshotBytesMatch(patched, readSnapshot(patched))).toBe(true);
    expect(patched).not.toHaveProperty("verdict");
  });
  it("preserves CRLF, whitespace and comments as exact bytes", async () => {
    const owned = await loadOwnedFixture();
    const crlf = Buffer.from('// frozen exact bytes\r\n' + generated.toString().replaceAll('\n', '\r\n'));
    const frozen = freezeDiscountTest(owned, crlf);
    expect(readSnapshot(prepareBaseline(frozen)).find(file => file.path === generatedIssuePath)!.content.equals(crlf)).toBe(true);
    expect(frozen.manifestSha256).not.toBe(freezeDiscountTest(owned, generated).manifestSha256);
  });
  it("protects internal bytes from input, output, manifest and patch-buffer mutation", async () => {
    const { owned, testBytes, frozen, baseline, change } = await setup();
    const patched = prepareDiscountPatch(frozen, [change]);
    owned.forEach(file => file.content.fill(0)); testBytes.fill(0); change.content.fill(0);
    const returned = readSnapshot(patched); returned.forEach(file => file.content.fill(0)); returned[0]!.path = "evil";
    expect(readSnapshot(patched).find(file => file.path === "src/discount.mjs")!.content.equals(fixedSource)).toBe(true);
    expect(readSnapshot(baseline).find(file => file.path === generatedIssuePath)!.content.equals(generated)).toBe(true);
    expect(() => Object.assign(frozen.manifest.files[0]!, { sha256: "0".repeat(64) })).toThrow();
    expect(() => Object.assign(frozen.manifest, { baseSha: "0".repeat(40) })).toThrow();
    expect(() => Object.assign(patched, { stage: "BASELINE" })).toThrow();
    expect(frozenTestsEquivalent(frozen, baseline, patched)).toBe(true);
  });
  it("does not accept forged, serialized or cross-freeze handles", async () => {
    const { owned, frozen, baseline, change } = await setup();
    const forged = JSON.parse(JSON.stringify(frozen));
    expect(() => prepareDiscountPatch(forged, [change])).toThrow("INVALID_HANDLE");
    expect(() => prepareBaseline(forged)).toThrow("INVALID_HANDLE");
    expect(() => readSnapshot(JSON.parse(JSON.stringify(baseline)))).toThrow("INVALID_HANDLE");
    const other = freezeDiscountTest(owned, generated), patched = prepareDiscountPatch(other, [change]);
    expect(frozenTestsEquivalent(frozen, baseline, patched)).toBe(false);
    expect(frozenTestsEquivalent(frozen, baseline, baseline)).toBe(false);
    expect(snapshotBytesMatch(JSON.parse(JSON.stringify(baseline)), readSnapshot(baseline))).toBe(false);
  });
  it.each(["tests/issue.generated.mjs", "tests/issue.mjs", "tests/regression.mjs", "package-lock.json", "package.json", ".env", ".github/workflows/check.yml", "src/verification/policy.ts", "src/../src/discount.mjs", "./src/discount.mjs", "src\\discount.mjs", "/src/discount.mjs", "C:/src/discount.mjs", "src/discount.mjs/child", "src/%64iscount.mjs", "src/discount.mjs\0"])("rejects protected or noncanonical patch path: %s", async path => {
    const { frozen, change } = await setup();
    expect(() => prepareDiscountPatch(frozen, [{ ...change, path }])).toThrow("PATCH_POLICY_VIOLATION");
  });
  it("rejects stale, empty, duplicate, extra-field, no-op and inadmissible patches", async () => {
    const { frozen, change, owned } = await setup();
    const attempts = [[], [change, change], [{ ...change, previousSha256: "0".repeat(64) }], [{ ...change, content: Buffer.alloc(0) }],
      [{ ...change, mode: "symlink" }], [{ ...change, content: owned.find(file => file.path === "src/discount.mjs")!.content }],
      [{ ...change, content: Buffer.from('export function applyDiscount(price, percentage) { return eval("0"); }') }]];
    for (const changes of attempts) expect(() => prepareDiscountPatch(frozen, changes)).toThrow("PATCH_POLICY_VIOLATION");
  });
  it("rejects modified owned fixture bytes and invalid generated tests", async () => {
    const owned = await loadOwnedFixture(); owned[0]!.content[0] = owned[0]!.content[0]! ^ 1;
    expect(() => freezeDiscountTest(owned, generated)).toThrow("INVALID_FIXTURE");
    for (const invalid of [Buffer.alloc(0), Buffer.from("test.skip('skip')"), Buffer.from([0xff]), Buffer.alloc(24001)]) {
      expect(() => freezeDiscountTest([], invalid)).toThrow("INVALID_FIXTURE");
    }
    const valid = await loadOwnedFixture();
    expect(() => freezeDiscountTest([{ ...valid[0]!, content: Buffer.alloc(24001) }, ...valid.slice(1)], generated)).toThrow("INVALID_FIXTURE");
    expect(() => freezeDiscountTest(valid, Buffer.from("test.skip('skip')"))).toThrow("INVALID_TEST");
    expect(() => freezeDiscountTest(valid, Buffer.alloc(24001))).toThrow("INVALID_TEST");
  });
  it("detects protected byte changes, extra/duplicate/missing paths and stale source artifacts", async () => {
    const { frozen, baseline, change } = await setup();
    const patched = prepareDiscountPatch(frozen, [change]);
    for (const file of readSnapshot(patched)) {
      const observed = readSnapshot(patched), content = observed.find(other => other.path === file.path)!.content;
      content[0] = content[0]! ^ 1;
      expect(snapshotBytesMatch(patched, observed)).toBe(false);
    }
    const observed = readSnapshot(patched);
    expect(snapshotBytesMatch(patched, observed.slice(1))).toBe(false);
    expect(snapshotBytesMatch(patched, [...observed, observed[0]!])).toBe(false);
    expect(snapshotBytesMatch(patched, observed.map(() => observed[0]!))).toBe(false);
    expect(snapshotBytesMatch(patched, readSnapshot(baseline))).toBe(false);
    observed[0]!.path = "../src/discount.mjs";
    expect(snapshotBytesMatch(patched, observed)).toBe(false);
  });
});
