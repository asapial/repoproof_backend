import { describe, expect, it } from "vitest";
import { decodeExecutionReceipt, encodeExecutionReceipt, type ExecutionPlan, type ExecutionReceipt } from "./results";

const hash = (character: string) => character.repeat(64);
const plan: ExecutionPlan = { provenance: "SYNTHETIC_OFFLINE_FIXTURE", expectedTests: 1, expectedAssertions: 1, maxDurationMs: 1000,
  binding: { runId: "10000000-0000-4000-8000-000000000001", executionId: "10000000-0000-4000-8000-000000000002",
    stage: "BASELINE", suite: "ISSUE", baseSha: "a".repeat(40), frozenManifestSha256: hash("b"), snapshotSha256: hash("c"),
    testSha256: hash("d"), runnerImageDigest: hash("e"), commandManifestSha256: hash("f") } };
function fixture(): ExecutionReceipt {
  return { version: "rpf-result-v1", provenance: "SYNTHETIC_OFFLINE_FIXTURE", binding: { ...plan.binding },
    startedAtMs: 1000, finishedAtMs: 1010, exitCode: 0, timedOut: false, setupFailure: false,
    tests: [{ index: 1, outcome: "PASSED", assertionsPassed: 1, assertionsFailed: 0, failureKind: null }],
    counts: { executed: 1, passed: 1, failed: 0, skipped: 0, assertionsPassed: 1, assertionsFailed: 0 },
    stdoutSha256: hash("1"), stderrSha256: hash("2"), artifactManifestSha256: plan.binding.snapshotSha256 };
}
const decode = (receipt: ExecutionReceipt, expected = plan) => decodeExecutionReceipt(encodeExecutionReceipt(receipt), expected);
describe("structured execution protocol (synthetic, never execution proof)", () => {
  it("validates a complete positive-count receipt but never promotes authenticity or a verdict", () => {
    const parsed = decode(fixture());
    expect(parsed).toMatchObject({ ok: true, value: { classification: "PASS", authentic: false } });
    if (!parsed.ok) throw new Error("fixture");
    expect(parsed.value).not.toHaveProperty("verdict");
    expect(() => Object.assign(parsed.value.receipt.counts, { executed: 0 })).toThrow();
    expect(() => Object.assign(parsed.value.receipt.tests[0]!, { outcome: "FAILED" })).toThrow();
  });
  it("classifies a genuine-shaped assertion failure separately from setup/import/syntax errors", () => {
    const value = fixture(); value.exitCode = 1;
    value.tests = [{ index: 1, outcome: "FAILED", assertionsPassed: 0, assertionsFailed: 1, failureKind: "ASSERTION" }];
    value.counts = { executed: 1, passed: 0, failed: 1, skipped: 0, assertionsPassed: 0, assertionsFailed: 1 };
    expect(decode(value)).toMatchObject({ value: { classification: "ASSERTION_FAILURE", authentic: false } });
    for (const kind of ["SETUP", "IMPORT", "SYNTAX", "UNKNOWN"] as const) {
      value.tests[0]!.failureKind = kind; value.tests[0]!.assertionsFailed = 0; value.counts.assertionsFailed = 0;
      expect(decode(value)).toMatchObject({ value: { classification: "INCONCLUSIVE" } });
    }
  });
  it.each(["runId", "executionId", "stage", "suite", "baseSha", "frozenManifestSha256", "snapshotSha256", "testSha256", "runnerImageDigest", "commandManifestSha256"] as const)("binds controller identity field %s", field => {
    const value = fixture();
    const change = field.endsWith("Id") ? "20000000-0000-4000-8000-000000000002" : field === "stage" ? "PATCHED" : field === "suite" ? "REGRESSIONS" : field === "baseSha" ? "0".repeat(40) : hash("0");
    Object.assign(value.binding, { [field]: change });
    expect(decode(value)).toEqual({ ok: false, reason: "BINDING_MISMATCH" });
  });
  it("rejects provenance and observed-artifact identity mismatches", () => {
    const value = fixture(); value.provenance = "UNVERIFIED_GUEST_OUTPUT";
    expect(decode(value)).toEqual({ ok: false, reason: "BINDING_MISMATCH" });
    value.provenance = "SYNTHETIC_OFFLINE_FIXTURE"; value.artifactManifestSha256 = hash("0");
    expect(decode(value)).toEqual({ ok: false, reason: "BINDING_MISMATCH" });
  });
  it.each(["executed", "passed", "failed", "skipped", "assertionsPassed", "assertionsFailed"] as const)("rejects contradictory summary %s", key => {
    const value = fixture(); value.counts[key]++;
    expect(decode(value)).toEqual({ ok: false, reason: "INCONSISTENT" });
  });
  it("keeps zero, skipped, timed-out, setup, null exit and over-budget receipts inconclusive", () => {
    for (const mutate of [
      (r: ExecutionReceipt) => { r.tests = []; r.counts = { executed: 0, passed: 0, failed: 0, skipped: 0, assertionsPassed: 0, assertionsFailed: 0 }; },
      (r: ExecutionReceipt) => { r.tests[0]!.outcome = "SKIPPED"; r.tests[0]!.assertionsPassed = 0; r.counts = { executed: 0, passed: 0, failed: 0, skipped: 1, assertionsPassed: 0, assertionsFailed: 0 }; },
      (r: ExecutionReceipt) => { r.timedOut = true; }, (r: ExecutionReceipt) => { r.setupFailure = true; },
      (r: ExecutionReceipt) => { r.exitCode = null; }, (r: ExecutionReceipt) => { r.exitCode = 1; },
      (r: ExecutionReceipt) => { r.finishedAtMs = r.startedAtMs + 1001; },
    ]) {
      const value = fixture(); mutate(value);
      expect(decode(value)).toMatchObject({ ok: true, value: { classification: "INCONCLUSIVE" } });
    }
    expect(decode(fixture(), { ...plan, expectedTests: 2 })).toMatchObject({ value: { classification: "INCONCLUSIVE" } });
    expect(decode(fixture(), { ...plan, expectedAssertions: 2 })).toMatchObject({ value: { classification: "INCONCLUSIVE" } });
  });
  it("rejects bad test IDs, impossible assertions, counts, time and exit status", () => {
    for (const mutate of [
      (r: ExecutionReceipt) => { r.tests[0]!.index = 2; },
      (r: ExecutionReceipt) => { r.tests[0]!.assertionsPassed = 0; },
      (r: ExecutionReceipt) => { r.tests[0]!.failureKind = "ASSERTION"; },
      (r: ExecutionReceipt) => { r.finishedAtMs = r.startedAtMs - 1; },
      (r: ExecutionReceipt) => { r.tests.push({ ...r.tests[0]! }); },
      (r: ExecutionReceipt) => { r.tests[0]!.assertionsPassed = 2; r.counts.assertionsPassed = 2; },
      (r: ExecutionReceipt) => { r.tests[0]!.outcome = "FAILED"; r.tests[0]!.assertionsPassed = 0; r.tests[0]!.assertionsFailed = 1; r.tests[0]!.failureKind = "ASSERTION"; r.counts = { executed: 1, passed: 0, failed: 1, skipped: 0, assertionsPassed: 0, assertionsFailed: 1 }; },
    ]) {
      const value = fixture(); mutate(value);
      expect(decode(value)).toEqual({ ok: false, reason: "INCONSISTENT" });
    }
  });
  it("rejects duplicate keys, unknown fields, malformed UTF-8/JSON, trailing/oversized and noncanonical bytes", () => {
    const raw = encodeExecutionReceipt(fixture()).toString();
    for (const value of ["", "{", raw + "\n", "\uFEFF" + raw, raw + raw, raw.replace('"version":', '"version":"rpf-result-v1","version":'),
      raw.replace('"counts":{', '"counts":{"executed":0,'), raw.replace('"version":', '"verdict":"VERIFIED","version":'),
      raw.replace('"exitCode":0', '"exitCode":-1'), raw.replace('"executed":1', '"executed":1.0'), raw.replace('"executed":1', '"executed":1e999'), "x".repeat(65537)]) {
      expect(decodeExecutionReceipt(Buffer.from(value), plan)).toEqual({ ok: false, reason: "MALFORMED" });
    }
    expect(decodeExecutionReceipt(Buffer.from([0xff]), plan)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(decodeExecutionReceipt(Buffer.from(raw), { ...plan, expectedTests: 0 })).toEqual({ ok: false, reason: "MALFORMED" });
  });
});
