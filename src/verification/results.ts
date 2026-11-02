import { z } from "zod";
import { sha256 } from "./frozen";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(512);
const timestamp = z.number().int().nonnegative().safe();
const provenance = z.enum(["SYNTHETIC_OFFLINE_FIXTURE", "UNVERIFIED_GUEST_OUTPUT"]);
const bindingSchema = z.object({ runId: z.string().uuid(), executionId: z.string().uuid(),
  stage: z.enum(["BASELINE", "PATCHED"]), suite: z.enum(["ISSUE", "REGRESSIONS"]),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/), frozenManifestSha256: digest, snapshotSha256: digest,
  testSha256: digest, runnerImageDigest: digest, commandManifestSha256: digest }).strict();
export const executionPlanSchema = z.object({ binding: bindingSchema, provenance,
  expectedTests: z.number().int().min(1).max(16), expectedAssertions: z.number().int().min(1).max(512),
  maxDurationMs: z.number().int().min(1).max(300000) }).strict();
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
const testSchema = z.object({ index: z.number().int().min(1).max(16), outcome: z.enum(["PASSED", "FAILED", "SKIPPED"]),
  assertionsPassed: count, assertionsFailed: count,
  failureKind: z.enum(["ASSERTION", "SETUP", "IMPORT", "SYNTAX", "UNKNOWN"]).nullable() }).strict();
export const executionReceiptSchema = z.object({ version: z.literal("rpf-result-v1"), provenance,
  binding: bindingSchema, startedAtMs: timestamp, finishedAtMs: timestamp,
  exitCode: z.number().int().min(0).max(255).nullable(), timedOut: z.boolean(), setupFailure: z.boolean(),
  tests: z.array(testSchema).max(16), counts: z.object({ executed: count, passed: count, failed: count,
    skipped: count, assertionsPassed: count, assertionsFailed: count }).strict(),
  stdoutSha256: digest, stderrSha256: digest, artifactManifestSha256: digest }).strict();
export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;
export type ResultClassification = "PASS" | "ASSERTION_FAILURE" | "INCONCLUSIVE";
export type DecodedExecution = Readonly<{ receipt: ExecutionReceipt; receiptSha256: string;
  classification: ResultClassification; authentic: false }>;
export type DecodeResult = { ok: true; value: DecodedExecution } | { ok: false; reason: "MALFORMED" | "BINDING_MISMATCH" | "INCONSISTENT" };

/** Canonical schema encoding only. Semantic checks and trust are separate. */
export function encodeExecutionReceipt(input: ExecutionReceipt): Buffer {
  return Buffer.from(JSON.stringify(executionReceiptSchema.parse(input)));
}

/** Parse inert protocol bytes, never test stdout as a trusted execution claim. */
export function decodeExecutionReceipt(bytes: Uint8Array, expected: ExecutionPlan): DecodeResult {
  let receipt: ExecutionReceipt, plan: ExecutionPlan, copy: Buffer;
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 65536) return { ok: false, reason: "MALFORMED" };
    copy = Buffer.from(bytes);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy);
    plan = executionPlanSchema.parse(expected);
    receipt = executionReceiptSchema.parse(JSON.parse(text));
    // Exact canonical bytes reject duplicate keys, trailing data, BOMs, alternate
    // numeric spellings and unknown fields rather than trusting JSON's last key.
    if (!copy.equals(encodeExecutionReceipt(receipt))) return { ok: false, reason: "MALFORMED" };
  } catch { return { ok: false, reason: "MALFORMED" }; }
  if (JSON.stringify(receipt.binding) !== JSON.stringify(plan.binding) || receipt.provenance !== plan.provenance ||
    receipt.artifactManifestSha256 !== plan.binding.snapshotSha256) return { ok: false, reason: "BINDING_MISMATCH" };
  const totals = { executed: 0, passed: 0, failed: 0, skipped: 0, assertionsPassed: 0, assertionsFailed: 0 };
  if (receipt.finishedAtMs < receipt.startedAtMs || receipt.tests.length > plan.expectedTests) return { ok: false, reason: "INCONSISTENT" };
  for (const [index, test] of receipt.tests.entries()) {
    if (test.index !== index + 1) return { ok: false, reason: "INCONSISTENT" };
    totals.assertionsPassed += test.assertionsPassed; totals.assertionsFailed += test.assertionsFailed;
    if (test.outcome === "SKIPPED") {
      if (test.assertionsPassed || test.assertionsFailed || test.failureKind !== null) return { ok: false, reason: "INCONSISTENT" };
      totals.skipped++;
    } else if (test.outcome === "PASSED") {
      if (!test.assertionsPassed || test.assertionsFailed || test.failureKind !== null) return { ok: false, reason: "INCONSISTENT" };
      totals.passed++; totals.executed++;
    } else {
      if (!test.failureKind || (test.failureKind === "ASSERTION" ? test.assertionsFailed !== 1 : test.assertionsFailed !== 0)) return { ok: false, reason: "INCONSISTENT" };
      totals.failed++; totals.executed++;
    }
  }
  if (JSON.stringify(totals) !== JSON.stringify(receipt.counts) || totals.assertionsPassed + totals.assertionsFailed > plan.expectedAssertions ||
    (totals.failed > 0 && receipt.exitCode === 0)) return { ok: false, reason: "INCONSISTENT" };
  let classification: ResultClassification = "INCONCLUSIVE";
  const complete = !receipt.timedOut && !receipt.setupFailure && receipt.finishedAtMs - receipt.startedAtMs <= plan.maxDurationMs &&
    receipt.tests.length === plan.expectedTests && totals.executed === plan.expectedTests && totals.skipped === 0;
  if (complete && totals.failed === 0 && receipt.exitCode === 0 && totals.assertionsPassed === plan.expectedAssertions) classification = "PASS";
  else if (complete && totals.failed > 0 && receipt.exitCode !== null && receipt.exitCode !== 0 &&
    receipt.tests.filter(test => test.outcome === "FAILED").every(test => test.failureKind === "ASSERTION")) classification = "ASSERTION_FAILURE";
  receipt.tests.forEach(Object.freeze); Object.freeze(receipt.tests); Object.freeze(receipt.counts); Object.freeze(receipt.binding); Object.freeze(receipt);
  return { ok: true, value: Object.freeze({ receipt, receiptSha256: sha256(copy), classification, authentic: false }) };
}
