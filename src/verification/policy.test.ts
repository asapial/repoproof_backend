import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideVerdict, type PolicyEvidence } from "./policy";

const bytes = Buffer.from("frozen test with assertion\n");
const hash = createHash("sha256").update(bytes).digest("hex");
const image = "a".repeat(64);
const command = "b".repeat(64);
const run = (outcome: "PASSED" | "FAILED", ref: string) => ({
  outcome, executed: 1, passed: outcome === "PASSED" ? 1 : 0, failed: outcome === "FAILED" ? 1 : 0,
  skipped: 0, exitCode: outcome === "PASSED" ? 0 : 1,
  failureKind: outcome === "FAILED" ? "ASSERTION" as const : null,
  baseSha: "d".repeat(40), runnerImageDigest: image, commandManifestSha256: command, sequence: ref.endsWith("before") || ref === "baseline" ? 2 : 4, ref,
});
function valid(): PolicyEvidence {
  return {
    baseSha: "d".repeat(40),
    frozen: { bytes, sha256: hash, testId: "issue-1", sequence: 1, ref: "frozen" },
    baseline: { ...run("FAILED", "baseline"), testId: "issue-1", testSha256: hash, sequence: 2 },
    patch: { sequence: 3, policy: "ALLOWED", ref: "patch" },
    patched: { ...run("PASSED", "patched"), testId: "issue-1", testSha256: hash, sequence: 4 },
    requiredCheckIds: ["regression"],
    checks: [{ id: "regression", baseline: run("PASSED", "regression-before"), patched: run("PASSED", "regression-after") }],
  };
}
const verdict = (e: unknown) => decideVerdict(e);

describe("deterministic verification policy", () => {
  it("verifies a genuine failure-to-pass with matching frozen bytes and passing checks", () => {
    expect(verdict(valid())).toMatchObject({ verdict: "VERIFIED", reasonCode: "REPRO_FAIL_TO_PASS_AND_REGRESSIONS_CLEAR" });
  });
  it("returns NO_REPRO only for a valid passing baseline with no patch", () => {
    const e = valid(); e.baseline = { ...e.baseline!, ...run("PASSED", "baseline") }; e.patch = null; e.patched = null; e.checks = [];
    expect(verdict(e)).toMatchObject({ verdict: "NO_REPRO", reasonCode: "BASELINE_DID_NOT_FAIL" });
    e.patch = valid().patch; expect(verdict(e)).toMatchObject({ verdict: "INCONCLUSIVE", reasonCode: "INVALID_NO_REPRO_SEQUENCE" });
  });
  it("rejects an unsuccessful patch, tampering, and failing regressions", () => {
    let e = valid(); e.patched = { ...e.patched!, ...run("FAILED", "patched") }; expect(verdict(e).verdict).toBe("REJECTED");
    e = valid(); e.patched!.testSha256 = "c".repeat(64); expect(verdict(e)).toMatchObject({ verdict: "REJECTED", reasonCode: "TEST_TAMPERING" });
    e = valid(); e.checks[0]!.patched = run("FAILED", "regression-after"); expect(verdict(e)).toMatchObject({ verdict: "REJECTED", reasonCode: "REGRESSION_INTRODUCED" });
  });
  it("rejects mismatched frozen bytes and patch policy violations", () => {
    const e = valid(); e.frozen!.bytes = Buffer.from("changed"); expect(verdict(e)).toMatchObject({ verdict: "REJECTED", reasonCode: "TEST_TAMPERING" });
    const p = valid(); p.patch!.policy = "TEST_TAMPERING"; expect(verdict(p)).toMatchObject({ verdict: "REJECTED", reasonCode: "TEST_TAMPERING" });
  });
  it("cannot verify missing evidence, zero, skipped, timeout, setup, or invalid counts", () => {
    const missing = valid(); missing.baseline = null; expect(verdict(missing).verdict).toBe("INCONCLUSIVE");
    for (const change of [
      { executed: 0, failed: 0 }, { skipped: 1 }, { outcome: "TIMEOUT", exitCode: null },
      { failureKind: "SETUP" }, { passed: 1 }, { exitCode: 0 }, { executed: 2, passed: 1 },
    ]) { const e = valid(); Object.assign(e.baseline!, change); expect(verdict(e).verdict).toBe("INCONCLUSIVE"); }
  });
  it("requires frozen test ordering, exact test identity, and independent provenance", () => {
    const late = valid(); late.frozen!.sequence = 3; expect(verdict(late).verdict).toBe("INCONCLUSIVE");
    const id = valid(); id.patched!.testId = "other"; expect(verdict(id).verdict).toBe("INCONCLUSIVE");
    const env = valid(); env.patched!.runnerImageDigest = "c".repeat(64); expect(verdict(env).verdict).toBe("INCONCLUSIVE");
    const base = valid(); base.patched!.baseSha = "e".repeat(40); expect(verdict(base).verdict).toBe("INCONCLUSIVE");
    const checks = valid(); checks.checks = []; expect(verdict(checks).verdict).toBe("INCONCLUSIVE");
  });
  it("requires every configured check and rejects genuine quality failures", () => {
    const missing = valid(); missing.requiredCheckIds.push("typecheck"); expect(verdict(missing).verdict).toBe("INCONCLUSIVE");
    const failed = valid(); failed.checks[0]!.patched = { ...run("FAILED", "regression-after"), failureKind: "CHECK_FAILURE" }; expect(verdict(failed)).toMatchObject({ verdict: "REJECTED", reasonCode: "REGRESSION_INTRODUCED" });
    const conflict = valid(); conflict.requiredCheckIds.push("lint"); conflict.checks[0]!.patched = run("FAILED", "regression-after"); conflict.checks.push({ id: "lint", baseline: run("PASSED", "lint-before"), patched: null }); expect(verdict(conflict).verdict).toBe("INCONCLUSIVE");
    const wrongOrder = valid(); wrongOrder.checks[0]!.patched!.sequence = 2; expect(verdict(wrongOrder).verdict).toBe("INCONCLUSIVE");
  });
  it("does not treat a model or client success claim as evidence", () => {
    expect(verdict({ verdict: "VERIFIED", success: true, claim: "fixed" }).verdict).toBe("INCONCLUSIVE");
  });
  it("gives tampering precedence over conflicting success and missing later evidence", () => {
    const e = valid(); e.frozen!.bytes = Buffer.from("tampered"); e.patched = null;
    expect(verdict(e)).toMatchObject({ verdict: "REJECTED", reasonCode: "TEST_TAMPERING" });
  });
  it("returns identical output and evidence references for identical inputs", () => {
    const e = valid(); expect(verdict(e)).toEqual(verdict(e)); expect(verdict(e).evidenceRefs).toEqual(["frozen", "baseline", "patch", "patched", "regression-before", "regression-after"]);
  });
});
