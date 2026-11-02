import { describe, expect, it, vi } from "vitest";
import { fixturePin, loadOwnedFixture } from "../sandbox/fixture";
import { freezeDiscountTest, prepareBaseline, sha256 } from "./frozen";
import { assertionBlueprintSha256, createAssertionCounter, decodeAssertionEvent, deriveAssertionBlueprint, encodeAssertionEvent,
  type AssertionBlueprint, type AssertionContext, type AssertionEvent } from "./assertionCounter";
import type { ReporterPlan } from "./reporter";

export function syntheticBlueprint(): AssertionBlueprint {
  return { version: "rpf-assertion-blueprint-v1",expectedFile: "/owned/trusted-self-test.mjs",tests: [{ index: 1,name: "trusted numeric assertions",assertions: 2 }],
    reporter: { version: "rpf-reporter-v1",assertionsPerTest: [2],plan: { provenance: "SYNTHETIC_OFFLINE_FIXTURE",expectedTests: 1,expectedAssertions: 2,maxDurationMs: 5000,
      binding: { runId: "10000000-0000-4000-8000-000000000001",executionId: "10000000-0000-4000-8000-000000000002",stage: "BASELINE",suite: "ISSUE",baseSha: fixturePin,
        frozenManifestSha256: "a".repeat(64),snapshotSha256: "b".repeat(64),testSha256: "c".repeat(64),runnerImageDigest: "d".repeat(64),commandManifestSha256: "e".repeat(64) } } } };
}
function harness() {
  const blueprint = syntheticBlueprint(), ctx: AssertionContext = { name: blueprint.tests[0]!.name,fullName: blueprint.tests[0]!.name,filePath: blueprint.expectedFile };
  let current: AssertionContext | undefined = ctx; const emit = vi.fn();
  return { blueprint,ctx,emit,setContext: (value: AssertionContext | undefined) => { current = value; },counter: createAssertionCounter(blueprint,() => current,emit) };
}
describe("owned assertion counter, trusted primitive self-tests only", () => {
  it("counts after native equal/strictEqual and rejects calls beyond the protected blueprint", () => {
    const h = harness(); h.counter.equal(1,1); h.counter.strictEqual(2,2);
    expect(h.emit.mock.calls.map(([event]) => event)).toMatchObject([{ index: 1,assertion: 1,outcome: "PASSED" },{ index: 1,assertion: 2,outcome: "PASSED" }]);
    expect(h.counter.authentic).toBe(false); expect(() => h.counter.equal(3,3)).toThrow("ASSERTION_COUNTER_UNAVAILABLE"); expect(h.emit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.emit.mock.calls.map(([event]) => event))).not.toMatch(/actual|expected|stack|message/);
  });
  it("emits a failed assertion and rethrows the genuine native error, then rejects further assertions", () => {
    const h = harness(); h.counter.equal(1,1);
    expect(() => h.counter.strictEqual(2,3)).toThrow(expect.objectContaining({ code: "ERR_ASSERTION",actual: 2,expected: 3 }));
    expect(h.emit.mock.calls[1]![0]).toMatchObject({ assertion: 2,outcome: "FAILED" });
    expect(() => h.counter.equal(4,4)).toThrow("ASSERTION_COUNTER_UNAVAILABLE"); expect(h.emit).toHaveBeenCalledTimes(2);
  });
  it.each(["missing","file","name","nested","identity"])("fails closed for wrong %s context and remains poisoned", changed => {
    const h = harness();
    if (changed === "identity") { h.counter.equal(1,1); h.setContext({ ...h.ctx }); }
    else if (changed === "missing") h.setContext(undefined);
    else { const ctx = { ...h.ctx }; if (changed === "file") ctx.filePath = "/other"; if (changed === "name") ctx.name = "other"; if (changed === "nested") ctx.fullName = "parent > "+ctx.name; h.setContext(ctx); }
    expect(() => h.counter.equal(1,1)).toThrow("ASSERTION_COUNTER_UNAVAILABLE"); h.setContext(h.ctx); expect(() => h.counter.equal(1,1)).toThrow("ASSERTION_COUNTER_UNAVAILABLE");
  });
  it("refuses extra args and unrecorded sink failures without retrying or leaking messages", () => {
    const h = harness(); expect(() => h.counter.equal(1,1,"message")).toThrow("ASSERTION_COUNTER_UNAVAILABLE"); expect(h.emit).not.toHaveBeenCalled();
    const failed = harness(); failed.emit.mockImplementation(() => { throw new Error("SENSITIVE sink failure"); });
    expect(() => failed.counter.equal(1,1)).toThrow("ASSERTION_COUNTER_UNAVAILABLE"); expect(() => failed.counter.equal(1,1)).toThrow("ASSERTION_COUNTER_UNAVAILABLE"); expect(failed.emit).toHaveBeenCalledTimes(1);
  });
  it("copies the blueprint and binds canonical events without serializing assertion values", () => {
    const h = harness(); h.blueprint.tests[0]!.assertions = 1; h.blueprint.reporter.plan.binding.testSha256 = "0".repeat(64);
    h.counter.equal(1,1); h.counter.equal(2,2); const event = h.emit.mock.calls[0]![0] as AssertionEvent;
    expect(decodeAssertionEvent(encodeAssertionEvent(event))).toEqual(event); expect(event.blueprintSha256).toBe(assertionBlueprintSha256(syntheticBlueprint()));
    for (const text of [" "+encodeAssertionEvent(event),encodeAssertionEvent(event).replace('"index":1','"index":1,"index":1'),'{"message":"secret"}',"x".repeat(1025)]) expect(() => decodeAssertionEvent(text)).toThrow("ASSERTION_EVENT_INVALID");
  });
  it("derives names and per-test counts from exact private admitted bytes without running them", async () => {
    const owned = await loadOwnedFixture(), frozen = freezeDiscountTest(owned,Buffer.from('import { test } from "node:test"; import assert from "node:assert/strict"; import { applyDiscount } from "../src/discount.mjs"; test("static two assertions", () => { assert.equal(applyDiscount(100, 20), 80); assert.strictEqual(applyDiscount(100, 0), 100); });'));
    const snapshot = prepareBaseline(frozen), file = snapshot.files.find(file => file.path === "tests/issue.generated.mjs")!, reporter: ReporterPlan = syntheticBlueprint().reporter;
    Object.assign(reporter.plan.binding,{ frozenManifestSha256: snapshot.frozenManifestSha256,snapshotSha256: snapshot.snapshotSha256,testSha256: file.sha256 });
    const blueprint = deriveAssertionBlueprint(snapshot,"10000000-0000-4000-8000-000000000003",reporter);
    expect(blueprint.tests).toEqual([{ index: 1,name: "static two assertions",assertions: 2 }]); expect(blueprint.expectedFile).toContain("/tests/issue.generated.mjs");
    const before = sha256(Buffer.from(JSON.stringify(snapshot)));
    reporter.plan.binding.testSha256 = "0".repeat(64); expect(() => deriveAssertionBlueprint(snapshot,"10000000-0000-4000-8000-000000000003",reporter)).toThrow("ASSERTION_BLUEPRINT_MISMATCH");
    expect(sha256(Buffer.from(JSON.stringify(snapshot)))).toBe(before);
    expect(() => deriveAssertionBlueprint(JSON.parse(JSON.stringify(snapshot)),"10000000-0000-4000-8000-000000000003",reporter)).toThrow();
  });
});
