import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeReporterEvent, OwnedReporterCollector, reporterPlanSha256, type ReporterCompletion, type ReporterEvent, type ReporterPlan } from "./reporter";
import { decideVerdict } from "./policy";

const plan: ReporterPlan = { version: "rpf-reporter-v1", assertionsPerTest: [2,1], plan: {
  provenance: "SYNTHETIC_OFFLINE_FIXTURE", expectedTests: 2, expectedAssertions: 3, maxDurationMs: 1000,
  binding: { runId: "10000000-0000-4000-8000-000000000001", executionId: "10000000-0000-4000-8000-000000000002",
    stage: "BASELINE", suite: "REGRESSIONS", baseSha: "a".repeat(40), frozenManifestSha256: "b".repeat(64), snapshotSha256: "c".repeat(64),
    testSha256: "d".repeat(64), runnerImageDigest: "e".repeat(64), commandManifestSha256: "f".repeat(64) } } };
const completion: ReporterCompletion = { startedAtMs: 1000, finishedAtMs: 1010, exitCode: 0, timedOut: false, setupFailure: false,
  stdoutSha256: "1".repeat(64), stderrSha256: "2".repeat(64), artifactManifestSha256: "c".repeat(64) };
function events(p = plan): ReporterEvent[] {
  return [{ type: "START", seq: 1, planSha256: reporterPlanSha256(p) }, { type: "TEST_START", seq: 2, index: 1 },
    { type: "ASSERTION", seq: 3, index: 1, assertion: 1, outcome: "PASSED" }, { type: "ASSERTION", seq: 4, index: 1, assertion: 2, outcome: "PASSED" },
    { type: "TEST_END", seq: 5, index: 1, outcome: "PASSED", failureKind: null }, { type: "TEST_START", seq: 6, index: 2 },
    { type: "ASSERTION", seq: 7, index: 2, assertion: 1, outcome: "PASSED" }, { type: "TEST_END", seq: 8, index: 2, outcome: "PASSED", failureKind: null }, { type: "END", seq: 9 }];
}
const bytes = (items: ReporterEvent[]) => Buffer.concat(items.map(encodeReporterEvent));
const renumber = (items: ReporterEvent[]) => items.map((item, i) => ({ ...item,seq: i+1 }));
function collect(items = events(), changes: Partial<ReporterCompletion> = {}, p = plan) {
  const collector = new OwnedReporterCollector(p); collector.write(bytes(items)); return collector.finish({ ...completion,...changes });
}

describe("owned reporter event protocol (synthetic data, never host test execution)", () => {
  it("builds exact counts/receipt and digest across byte-by-byte chunk boundaries", () => {
    const input = bytes(events()), collector = new OwnedReporterCollector(plan);
    for (const byte of input) expect(collector.write(Uint8Array.of(byte))).toBe(true);
    const result = collector.finish(completion);
    expect(result).toMatchObject({ ok: true, value: { authentic: false, eventStreamSha256: createHash("sha256").update(input).digest("hex"), decoded: {
      authentic: false, classification: "PASS", receipt: { counts: { executed: 2, passed: 2, failed: 0, skipped: 0, assertionsPassed: 3, assertionsFailed: 0 } } } } });
    expect(result).not.toHaveProperty("verdict"); expect(decideVerdict(result).verdict).toBe("INCONCLUSIVE");
    expect(JSON.stringify(collector)).toBe('{"reporter":"rpf-reporter-v1","authentic":false}');
    expect(collector.finish(completion)).toEqual({ ok: false,reason: "CLOSED" }); expect(collector.write(input)).toBe(false);
  });
  it("can classify only an explicit assertion-failure sequence as assertion failure", () => {
    const input = events(); Object.assign(input[3]!, { outcome: "FAILED" }); Object.assign(input[4]!, { outcome: "FAILED",failureKind: "ASSERTION" });
    expect(collect(input, { exitCode: 1 })).toMatchObject({ ok: true,value: { authentic: false,decoded: { classification: "ASSERTION_FAILURE",receipt: { counts: { assertionsPassed: 2,assertionsFailed: 1 } } } } });
    Object.assign(input[2]!, { outcome: "FAILED" }); input.splice(3,1);
    expect(collect(renumber(input), { exitCode: 1 })).toMatchObject({ ok: true,value: { decoded: { classification: "ASSERTION_FAILURE",receipt: { counts: { assertionsPassed: 1,assertionsFailed: 1 } } } } });
  });
  it.each(["SETUP","IMPORT","SYNTAX","UNKNOWN"] as const)("keeps %s failure inconclusive with no invented assertion", failureKind => {
    const input = events(); input.splice(2,2); Object.assign(input[2]!, { outcome: "FAILED",failureKind });
    expect(collect(renumber(input), { exitCode: 1 })).toMatchObject({ ok: true,value: { decoded: { classification: "INCONCLUSIVE",receipt: { counts: { assertionsPassed: 1,assertionsFailed: 0 } } } } });
  });
  it("keeps zero, missing and skipped tests inconclusive", () => {
    expect(collect(renumber([events()[0]!,events()[8]!]))).toMatchObject({ ok: true,value: { decoded: { classification: "INCONCLUSIVE",receipt: { counts: { executed: 0 } } } } });
    expect(collect(renumber([...events().slice(0,5),events()[8]!]))).toMatchObject({ ok: true,value: { decoded: { classification: "INCONCLUSIVE" } } });
    const input = events(); input.splice(2,2); Object.assign(input[2]!, { outcome: "SKIPPED" });
    expect(collect(renumber(input))).toMatchObject({ ok: true,value: { decoded: { classification: "INCONCLUSIVE",receipt: { counts: { skipped: 1 } } } } });
  });
  it.each([{ timedOut: true }, { setupFailure: true }, { exitCode: null }, { exitCode: 1 }, { finishedAtMs: 3000 }])("cannot promote successful events with bad process observation %j", changed => {
    expect(collect(events(),changed)).toMatchObject({ ok: true,value: { decoded: { classification: "INCONCLUSIVE" } } });
  });
  it("requires matching plan/artifact/process bindings from outside the event channel", () => {
    const input = events(); Object.assign(input[0]!, { planSha256: "0".repeat(64) });
    expect(collect(input)).toEqual({ ok: false,reason: "BINDING_MISMATCH" });
    expect(collect(events(),{ artifactManifestSha256: "0".repeat(64) })).toEqual({ ok: false,reason: "BINDING_MISMATCH" });
    expect(collect(events(),{ finishedAtMs: 999 })).toEqual({ ok: false,reason: "INCONSISTENT" });
    expect(collect(events(),{ exitCode: -1 })).toEqual({ ok: false,reason: "MALFORMED" });
  });
  it.each(["seq","index","assertion","duplicate","nested","afterFailure","afterEnd","noStart"])("rejects invalid lifecycle %s", scenario => {
    let input = events();
    if (scenario === "seq") input[2]!.seq = 1;
    if (scenario === "index") Object.assign(input[2]!, { index: 2 });
    if (scenario === "assertion") Object.assign(input[2]!, { assertion: 2 });
    if (scenario === "duplicate") input = renumber([...input.slice(0,3),input[2]!,...input.slice(3)]);
    if (scenario === "nested") input[2] = { type: "TEST_START", seq: 3,index: 2 };
    if (scenario === "afterFailure") Object.assign(input[2]!, { outcome: "FAILED" });
    if (scenario === "afterEnd") input.push({ type: "END",seq: 10 });
    if (scenario === "noStart") input = renumber(input.slice(1));
    const result = collect(input); expect(result.ok).toBe(false);
  });
  it.each(["missingAssertion","falseFailure","wrongFailure","skipAfterAssertion","extraAssertion"])("rejects false per-test claims %s", scenario => {
    let input = events();
    if (scenario === "missingAssertion") { input.splice(3,1); input = renumber(input); }
    if (scenario === "falseFailure") Object.assign(input[4]!, { outcome: "FAILED",failureKind: "ASSERTION" });
    if (scenario === "wrongFailure") { Object.assign(input[3]!, { outcome: "FAILED" }); Object.assign(input[4]!, { outcome: "FAILED",failureKind: "SETUP" }); }
    if (scenario === "skipAfterAssertion") Object.assign(input[4]!, { outcome: "SKIPPED" });
    if (scenario === "extraAssertion") input = renumber([...input.slice(0,4),{ type: "ASSERTION",seq: 1,index: 1,assertion: 3,outcome: "PASSED" },...input.slice(4)]);
    expect(collect(input).ok).toBe(false);
  });
  it.each(['{"type":"END","seq":1,"seq":2}\n','{"type":"END","s\\u0065q":1}\n',' {"type":"END","seq":1}\n',
    '{"type":"END","seq":1,"__proto__":{}}\n','{"type":"END","seq":1,"verdict":"VERIFIED"}\n',
    '{"type":"END","seq":1e0}\n','{"type":"END","seq":1}\r\n','test passed: 1\n','\ufeff{"type":"END","seq":1}\n'])
  ("rejects ambiguous/raw event bytes without reflecting contents", text => {
    const collector = new OwnedReporterCollector(plan); expect(collector.write(Buffer.from(text))).toBe(false);
    const result = collector.finish(completion); expect(result).toEqual({ ok: false,reason: "MALFORMED" }); expect(JSON.stringify(result)).not.toContain("__proto__");
  });
  it("fails closed for invalid UTF-8, oversized lines/stream, and a persistent first failure", () => {
    for (const input of [Uint8Array.of(0xff,10),Buffer.alloc(1025,120),Buffer.alloc(131073,10)]) {
      const collector = new OwnedReporterCollector(plan); expect(collector.write(input)).toBe(false); expect(collector.write(bytes(events()))).toBe(false); expect(collector.finish(completion).ok).toBe(false);
    }
    const collector = new OwnedReporterCollector(plan); expect(collector.write("bad" as never)).toBe(false); expect(collector.finish(completion)).toEqual({ ok: false,reason: "MALFORMED" });
  });
  it("requires complete EOF framing and end marker and rejects unfinished active tests", () => {
    for (const input of [Buffer.alloc(0),bytes(events().slice(0,-1)),bytes(events()).subarray(0,-1)]) {
      const collector = new OwnedReporterCollector(plan); collector.write(input); expect(collector.finish(completion)).toEqual({ ok: false,reason: "INCOMPLETE" });
    }
    expect(collect(renumber([events()[0]!,events()[1]!,events()[8]!]))).toEqual({ ok: false,reason: "ORDER" });
  });
  it("defensively copies plan and chunks and never authenticates forged guest success", () => {
    const source = structuredClone(plan); source.plan.provenance = "UNVERIFIED_GUEST_OUTPUT";
    const collector = new OwnedReporterCollector(source), input = bytes(events(source));
    source.assertionsPerTest[0] = 31; source.plan.binding.testSha256 = "0".repeat(64);
    expect(collector.write(input)).toBe(true); input.fill(0);
    expect(collector.finish(completion)).toMatchObject({ ok: true,value: { authentic: false,decoded: { authentic: false,classification: "PASS",receipt: { provenance: "UNVERIFIED_GUEST_OUTPUT",binding: { testSha256: "d".repeat(64) } } } } });
  });
  it.each([{ assertionsPerTest: [1,1] },{ assertionsPerTest: [0,3] },{ assertionsPerTest: [33,1] },{ assertionsPerTest: [] },{ assertionsPerTest: [1,1,1] }])("rejects a per-test blueprint inconsistent with the protected plan %j", ({ assertionsPerTest }) => {
    expect(() => new OwnedReporterCollector({ ...plan,assertionsPerTest })).toThrow();
  });
});
