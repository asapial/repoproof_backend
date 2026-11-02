// Deterministic inert fixtures. These are never inference or execution evidence.
import { z } from "zod";
import type { ExecutionPlan, ExecutionReceipt } from "./results";
import { encodeExecutionReceipt } from "./results";
import { generatedIssuePath, readSnapshot, type PreparedSnapshot } from "./frozen";

export const offlineScenarioSchema = z.enum(["FAIL_TO_PASS", "NO_REPRO", "TEST_SKIP", "TEST_EMPTY", "MODEL_CLAIM", "GENERATOR_ERROR",
  "BASELINE_ZERO", "BASELINE_SKIP", "BASELINE_SETUP", "BASELINE_TIMEOUT", "BASELINE_MALFORMED", "BASELINE_HASH_MISMATCH", "BASELINE_ARTIFACT_TAMPER",
  "BASELINE_REGRESSION_FAILURE", "PATCH_PROTECTED", "PATCH_GLOBAL_MUTATION", "PATCH_STALE_HASH", "PATCH_BASE_MISMATCH",
  "PATCHED_ISSUE_FAILURE", "PATCHED_REGRESSION_FAILURE", "PATCHED_ZERO", "PATCHED_SKIP", "PATCHED_SETUP", "PATCHED_TIMEOUT",
  "PATCHED_MALFORMED", "PATCHED_HASH_MISMATCH", "PATCHED_ARTIFACT_TAMPER", "PATCHED_IMAGE_MISMATCH", "PATCHED_PHASE_SWAP",
  "CANCEL_AFTER_BASELINE", "UNCERTAIN_PATCHED_EXECUTION"]);
export type OfflineScenario = z.infer<typeof offlineScenarioSchema>;
export const syntheticModel = "synthetic-offline-discount-fixture";
const generated = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { applyDiscount } from "../src/discount.mjs";\ntest("generated percentage regression", () => { assert.equal(applyDiscount(100, 20), 80); });\n';
export function syntheticTestProposal(scenario: OfflineScenario): unknown {
  const content = scenario === "TEST_SKIP" ? generated.replace('test("', 'test.skip("') : scenario === "TEST_EMPTY" ? generated.replace('assert.equal(applyDiscount(100, 20), 80);', '') : generated;
  return { path: generatedIssuePath, content, assertionPurpose: "Synthetic percentage-discount regression fixture",
    ...(scenario === "MODEL_CLAIM" ? { verdict: "VERIFIED" } : {}) };
}
export function syntheticPatchProposal(scenario: OfflineScenario, baseSha: string, previousSha256: string): unknown {
  return { baseSha: scenario === "PATCH_BASE_MISMATCH" ? "0".repeat(40) : baseSha,
    changes: [{ path: scenario === "PATCH_PROTECTED" ? "src/verification/policy.ts" : "src/discount.mjs",
      previousSha256: scenario === "PATCH_STALE_HASH" ? "0".repeat(64) : previousSha256,
      content: scenario === "PATCH_GLOBAL_MUTATION" ? 'export function applyDiscount(price, percentage) { globalThis.syntheticEscape = true; return price; }\n' :
        'export function applyDiscount(price, percentage) { return price - (price * percentage) / 100; }\n' }],
    explanation: "Synthetic source replacement fixture; never executed" };
}
export function syntheticExecution(scenario: OfflineScenario, plan: ExecutionPlan, snapshot: PreparedSnapshot) {
  const issue = plan.binding.suite === "ISSUE", baseline = plan.binding.stage === "BASELINE";
  const prefix = baseline ? "BASELINE_" : "PATCHED_";
  if (!baseline && issue && scenario === "UNCERTAIN_PATCHED_EXECUTION") throw new Error("SYNTHETIC_UNCERTAIN_EXECUTION");
  const failing = (baseline && issue && scenario !== "NO_REPRO") || (!baseline && issue && scenario === "PATCHED_ISSUE_FAILURE") ||
    (!issue && scenario === (baseline ? "BASELINE_REGRESSION_FAILURE" : "PATCHED_REGRESSION_FAILURE"));
  const tests: ExecutionReceipt["tests"] = Array.from({ length: plan.expectedTests }, (_, index) => ({ index: index + 1,
    outcome: failing && index === 0 ? "FAILED" : "PASSED", assertionsPassed: failing && index === 0 ? 0 : 1,
    assertionsFailed: failing && index === 0 ? 1 : 0, failureKind: failing && index === 0 ? "ASSERTION" : null }));
  if (issue && scenario === prefix + "ZERO") tests.splice(0);
  if (issue && scenario === prefix + "SKIP") tests[0] = { index: 1, outcome: "SKIPPED", assertionsPassed: 0, assertionsFailed: 0, failureKind: null };
  if (issue && scenario === prefix + "SETUP") tests[0] = { index: 1, outcome: "FAILED", assertionsPassed: 0, assertionsFailed: 0, failureKind: "SETUP" };
  const passed = tests.filter(test => test.outcome === "PASSED").length, failed = tests.filter(test => test.outcome === "FAILED").length;
  const receipt: ExecutionReceipt = { version: "rpf-result-v1", provenance: "SYNTHETIC_OFFLINE_FIXTURE", binding: { ...plan.binding },
    startedAtMs: 1000, finishedAtMs: 1010, exitCode: failed ? 1 : 0, timedOut: issue && scenario === prefix + "TIMEOUT",
    setupFailure: issue && scenario === prefix + "SETUP", tests,
    counts: { executed: passed + failed, passed, failed, skipped: tests.length - passed - failed,
      assertionsPassed: tests.reduce((n, test) => n + test.assertionsPassed, 0), assertionsFailed: tests.reduce((n, test) => n + test.assertionsFailed, 0) },
    stdoutSha256: "1".repeat(64), stderrSha256: "2".repeat(64), artifactManifestSha256: plan.binding.snapshotSha256 };
  if (issue && scenario === prefix + "HASH_MISMATCH") receipt.binding.testSha256 = "0".repeat(64);
  if (!baseline && issue && scenario === "PATCHED_IMAGE_MISMATCH") receipt.binding.runnerImageDigest = "0".repeat(64);
  if (!baseline && issue && scenario === "PATCHED_PHASE_SWAP") receipt.binding.stage = "BASELINE";
  const artifacts = readSnapshot(snapshot);
  if (issue && scenario === prefix + "ARTIFACT_TAMPER") {
    const file = artifacts.find(file => file.path === generatedIssuePath)!;
    file.content = Buffer.concat([file.content, Buffer.from("\n")]);
  }
  return { receiptBytes: issue && scenario === prefix + "MALFORMED" ? Buffer.from('{"verdict":"VERIFIED"}') : encodeExecutionReceipt(receipt), artifacts };
}
