import { createHash } from "node:crypto";
import { z } from "zod";
import { baseShaSchema, testOutcomeSchema, type VerificationVerdict } from "../contracts/repoproof";

// This pure policy accepts only evidence assembled by a trusted server-side controller.
// It cannot establish the authenticity of a caller, runner, or artifact store.
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const ref = z.string().trim().min(1).max(512);
const sequence = z.number().int().nonnegative().safe();
const execution = z.object({
  outcome: testOutcomeSchema, executed: sequence, passed: sequence, failed: sequence, skipped: sequence,
  exitCode: z.number().int().nullable(), failureKind: z.enum(["ASSERTION", "SETUP", "IMPORT", "SYNTAX", "UNKNOWN", "CHECK_FAILURE"]).nullable(),
  baseSha: baseShaSchema, runnerImageDigest: digest, commandManifestSha256: digest, sequence, ref,
});
const issueExecution = execution.extend({ testId: ref, testSha256: digest, sequence });
const frozen = z.object({ bytes: z.instanceof(Uint8Array), sha256: digest, testId: ref, sequence, ref });
const patch = z.object({ sequence, policy: z.enum(["ALLOWED", "TEST_TAMPERING", "PATCH_POLICY_VIOLATION"]), ref });
const check = z.object({ id: ref, baseline: execution.nullable(), patched: execution.nullable() });
const evidenceSchema = z.object({ baseSha: baseShaSchema, frozen: frozen.nullable(), baseline: issueExecution.nullable(), patch: patch.nullable(), patched: issueExecution.nullable(), requiredCheckIds: z.array(ref).min(1), checks: z.array(check) });
export type PolicyEvidence = z.infer<typeof evidenceSchema>;
type Execution = z.infer<typeof execution>;
export type PolicyReason = "EVIDENCE_INCOMPLETE_OR_UNTRUSTED" | "TEST_TAMPERING" | "PATCH_POLICY_VIOLATION" | "INVALID_NO_REPRO_SEQUENCE" | "BASELINE_DID_NOT_FAIL" | "BASELINE_FAILURE_NOT_ISSUE_ASSERTION" | "BASELINE_REGRESSIONS_UNTRUSTED" | "TEST_OR_ENVIRONMENT_MISMATCH" | "PATCHED_ISSUE_TEST_MISSING" | "ISSUE_TEST_STILL_FAILS" | "REGRESSION_EVIDENCE_MISSING" | "REGRESSION_INTRODUCED" | "REPRO_FAIL_TO_PASS_AND_REGRESSIONS_CLEAR";
export interface PolicyResult { verdict: VerificationVerdict; reasonCode: PolicyReason; evidenceRefs: string[]; policyVersion: "rpf-verdict-v1" }

function result(verdict: VerificationVerdict, reasonCode: PolicyReason, evidenceRefs: string[]): PolicyResult {
  return { verdict, reasonCode, evidenceRefs, policyVersion: "rpf-verdict-v1" };
}
function validExecution(run: Execution, allowCheckFailure = false): boolean {
  if (run.executed <= 0 || run.skipped !== 0 || run.passed + run.failed !== run.executed) return false;
  if (run.outcome === "PASSED") return run.passed === run.executed && run.failed === 0 && run.exitCode === 0 && run.failureKind === null;
  if (run.outcome === "FAILED") return run.failed > 0 && run.exitCode !== null && run.exitCode !== 0 && (run.failureKind === "ASSERTION" || (allowCheckFailure && run.failureKind === "CHECK_FAILURE"));
  return false;
}

/**
 * Precedence: malformed evidence; detected test tampering; baseline validity and
 * no-repro; patch policy; baseline checks; patched execution; patched checks.
 * Matching hashes verify bytes, not the authenticity of the evidence source.
 */
export function decideVerdict(input: unknown): PolicyResult {
  const parsed = evidenceSchema.safeParse(input);
  if (!parsed.success) return result("INCONCLUSIVE", "EVIDENCE_INCOMPLETE_OR_UNTRUSTED", []);
  const e = parsed.data;
  const refs = [e.frozen?.ref, e.baseline?.ref, e.patch?.ref, e.patched?.ref, ...e.checks.flatMap(c => [c.baseline?.ref, c.patched?.ref])].filter((x): x is string => x !== undefined);
  const incomplete = (reason: PolicyReason) => result("INCONCLUSIVE", reason, refs);
  const rejected = (reason: PolicyReason) => result("REJECTED", reason, refs);

  if (e.patch?.policy === "TEST_TAMPERING") return rejected("TEST_TAMPERING");
  if (e.frozen && e.frozen.bytes.byteLength > 0) {
    const hash = createHash("sha256").update(e.frozen.bytes).digest("hex");
    if (hash !== e.frozen.sha256 || (e.baseline && e.baseline.testSha256 !== e.frozen.sha256) || (e.patched && e.patched.testSha256 !== e.frozen.sha256)) return rejected("TEST_TAMPERING");
  }
  if (!e.frozen || !e.baseline || e.frozen.bytes.byteLength === 0) return incomplete("EVIDENCE_INCOMPLETE_OR_UNTRUSTED");
  if (e.frozen.sequence >= e.baseline.sequence || e.baseline.testId !== e.frozen.testId || e.baseline.baseSha !== e.baseSha || e.baseline.executed !== 1 || !validExecution(e.baseline)) return incomplete("EVIDENCE_INCOMPLETE_OR_UNTRUSTED");
  if (e.baseline.outcome === "PASSED") {
    if (e.patch !== null || e.patched !== null || e.checks.some(c => c.patched !== null)) return incomplete("INVALID_NO_REPRO_SEQUENCE");
    return result("NO_REPRO", "BASELINE_DID_NOT_FAIL", refs);
  }
  if (e.baseline.outcome !== "FAILED" || e.baseline.failureKind !== "ASSERTION") return incomplete("BASELINE_FAILURE_NOT_ISSUE_ASSERTION");
  if (!e.patch || e.patch.sequence <= e.baseline.sequence) return incomplete("EVIDENCE_INCOMPLETE_OR_UNTRUSTED");
  if (e.patch.policy === "PATCH_POLICY_VIOLATION") return rejected("PATCH_POLICY_VIOLATION");
  if (new Set(e.requiredCheckIds).size !== e.requiredCheckIds.length || e.checks.length !== e.requiredCheckIds.length || new Set(e.checks.map(c => c.id)).size !== e.checks.length || e.requiredCheckIds.some(id => !e.checks.some(c => c.id === id)) || e.checks.some(c => !c.baseline || !validExecution(c.baseline, true) || c.baseline.outcome !== "PASSED" || c.baseline.sequence >= e.patch!.sequence || c.baseline.baseSha !== e.baseSha || c.baseline.runnerImageDigest !== e.baseline!.runnerImageDigest)) return incomplete("BASELINE_REGRESSIONS_UNTRUSTED");
  if (!e.patched || e.patched.sequence <= e.patch.sequence) return incomplete("PATCHED_ISSUE_TEST_MISSING");
  if (e.patched.baseSha !== e.baseSha || e.patched.testId !== e.frozen.testId || e.patched.runnerImageDigest !== e.baseline.runnerImageDigest || e.patched.commandManifestSha256 !== e.baseline.commandManifestSha256) return incomplete("TEST_OR_ENVIRONMENT_MISMATCH");
  if (e.patched.executed !== 1 || !validExecution(e.patched)) return incomplete("EVIDENCE_INCOMPLETE_OR_UNTRUSTED");
  if (e.patched.outcome === "FAILED") return rejected("ISSUE_TEST_STILL_FAILS");
  for (const c of e.checks) {
    if (!c.baseline || !c.patched || !validExecution(c.patched, true) || c.patched.sequence <= e.patch.sequence) return incomplete("REGRESSION_EVIDENCE_MISSING");
    if (c.patched.baseSha !== e.baseSha || c.patched.runnerImageDigest !== c.baseline.runnerImageDigest || c.patched.commandManifestSha256 !== c.baseline.commandManifestSha256) return incomplete("TEST_OR_ENVIRONMENT_MISMATCH");
  }
  if (e.checks.some(c => c.patched?.outcome === "FAILED")) return rejected("REGRESSION_INTRODUCED");
  return result("VERIFIED", "REPRO_FAIL_TO_PASS_AND_REGRESSIONS_CLEAR", refs);
}
