import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessReconciliation, encodeReconciliation, reconciliationRecord, reconciliationSigningBytes, reviewProviderTiming,
  type ReconciliationContext, type ReconciliationObservation, type ReconciliationTrustKey } from "./reconciliation";

// Ephemeral synthetic keys and signed observations only. No provider requests.
const pair = generateKeyPairSync("ed25519");
const key: ReconciliationTrustKey = { keyId: "synthetic-observer", purpose: "reconciliation-observer",
  publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), liveIdentityApproved: false };
const fingerprint = createHash("sha256").update(pair.publicKey.export({ type: "spki", format: "der" })).digest("hex");
const context: ReconciliationContext = { jobId: "10000000-0000-4000-8000-000000000001", effectId: "10000000-0000-4000-8000-000000000002",
  jobVersion: 2, kind: "SANDBOX", requestHash: "a".repeat(64), state: "QUARANTINED", cancelRequested: false, deadlineAtMs: 5000 };
function observation(overrides: Partial<Omit<ReconciliationObservation, "signature">> = {}): ReconciliationObservation {
  const unsigned: Omit<ReconciliationObservation, "signature"> = { version: "rpf-reconciliation-v1", evidenceId: "10000000-0000-4000-8000-000000000003",
    context: { ...context }, source: "OFFLINE_SYNTHETIC", keyId: key.keyId, observedAtMs: 1000, expiresAtMs: 2000,
    observedState: "STOPPED", providerIdentitySha256: "b".repeat(64), cleanupConfirmed: true, noChargeConfirmed: false,
    factsSha256: "c".repeat(64), ...overrides };
  return { ...unsigned, signature: sign(null, reconciliationSigningBytes(unsigned), pair.privateKey).toString("hex") };
}
const expected = { context, source: "OFFLINE_SYNTHETIC" as const, dispatcherFingerprint: "d".repeat(64) };
const assess = (value: ReconciliationObservation) => assessReconciliation(encodeReconciliation(value), [key], expected, 1000);

describe("independent uncertain-effect reconciliation", () => {
  it.each(["UNKNOWN", "NOT_FOUND", "RUNNING", "STOPPED", "COMPLETED", "FAILED", "CANCELLED"] as const)("retains quarantine for signed synthetic state %s", observedState => {
    const result = assess(observation({ observedState, cleanupConfirmed: ["STOPPED", "CANCELLED"].includes(observedState),
      providerIdentitySha256: ["UNKNOWN", "NOT_FOUND"].includes(observedState) ? null : "b".repeat(64) }));
    expect(result).toMatchObject({ ok: true, value: { decision: "KEEP_QUARANTINED", redispatchAllowed: false, releaseAllowed: false, independentFactsReviewRequired: true } });
  });
  it("protects accepted records from mutation and rejects serialized authority", () => {
    const raw = observation(), result = assess(raw);
    if (!result.ok) throw new Error("synthetic fixture");
    raw.context.jobVersion++; const exported = reconciliationRecord(result.value); exported.context.jobVersion++;
    expect(reconciliationRecord(result.value).context.jobVersion).toBe(2);
    expect(() => Object.assign(result.value, { releaseAllowed: true })).toThrow();
    expect(() => reconciliationRecord(JSON.parse(JSON.stringify(result.value)))).toThrow("INVALID_RECONCILIATION");
    expect(JSON.stringify(result.value)).not.toContain("PRIVATE KEY");
  });
  it.each(["jobId", "effectId", "jobVersion", "kind", "requestHash", "cancelRequested", "deadlineAtMs"] as const)("requires exact durable context %s", field => {
    const changed = { ...context };
    Object.assign(changed, { [field]: field.endsWith("Id") ? "20000000-0000-4000-8000-000000000004" : field === "jobVersion" ? 3 : field === "kind" ? "META" : field === "requestHash" ? "e".repeat(64) : field === "cancelRequested" ? true : 6000 });
    expect(assessReconciliation(encodeReconciliation(observation()), [key], { ...expected, context: changed }, 1000)).toEqual({ ok: false, reason: "BINDING_OR_TIME" });
  });
  it("accepts fresh observations after cancel/deadline only while retaining quarantine", () => {
    const current = { ...context, jobVersion: 3, cancelRequested: true, deadlineAtMs: 900 };
    expect(assessReconciliation(encodeReconciliation(observation({ context: current })), [key], { ...expected, context: current }, 1000))
      .toMatchObject({ ok: true, value: { decision: "KEEP_QUARANTINED", releaseAllowed: false } });
  });
  it("keeps completed zero-charge Meta observations quarantined for independent fact review", () => {
    const current = { ...context, kind: "META" as const };
    const raw = observation({ context: current, observedState: "COMPLETED", cleanupConfirmed: false, noChargeConfirmed: true });
    expect(assessReconciliation(encodeReconciliation(raw), [key], { ...expected, context: current }, 1000))
      .toMatchObject({ ok: true, value: { redispatchAllowed: false, releaseAllowed: false, independentFactsReviewRequired: true } });
  });
  it("rejects stale/future/overlong observations and malformed canonical data", () => {
    for (const override of [{ observedAtMs: 1001 }, { expiresAtMs: 1000 }, { expiresAtMs: 1000 + 300001 }]) {
      expect(assess(observation(override))).toEqual({ ok: false, reason: "BINDING_OR_TIME" });
    }
    const bytes = encodeReconciliation(observation());
    for (const invalid of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.alloc(16385), Buffer.from(bytes.toString() + "\n"),
      Buffer.from(bytes.toString().replace('"version":', '"version":"rpf-reconciliation-v1","version":'))]) {
      expect(assessReconciliation(invalid, [key], expected, 1000)).toEqual({ ok: false, reason: "INVALID" });
    }
  });
  it("rejects forged signatures, duplicate/unknown keys and dispatcher/observer key reuse", () => {
    const raw = observation(); raw.factsSha256 = "0".repeat(64);
    expect(assess(raw).ok).toBe(false);
    for (const keys of [[], [key, key], [{ ...key, keyId: "unknown" }], [{ ...key, publicKeyPem: "invalid" }]]) {
      expect(assessReconciliation(encodeReconciliation(observation()), keys, expected, 1000).ok).toBe(false);
    }
    expect(assessReconciliation(encodeReconciliation(observation()), [key], { ...expected, dispatcherFingerprint: fingerprint }, 1000))
      .toEqual({ ok: false, reason: "TRUST_OR_SIGNATURE" });
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(assessReconciliation(encodeReconciliation(observation()), [{ ...key, publicKeyPem: ec.publicKey.export({ type: "spki", format: "pem" }).toString() }], expected, 1000).ok).toBe(false);
  });
  it("never silently promotes synthetic observations to approved live identity", () => {
    const raw = observation({ source: "LIVE_PROVIDER" });
    expect(assess(raw).ok).toBe(false);
    const liveExpected = { ...expected, source: "LIVE_PROVIDER" as const };
    expect(assessReconciliation(encodeReconciliation(raw), [key], liveExpected, 1000).ok).toBe(false);
    expect(assessReconciliation(encodeReconciliation(raw), [{ ...key, liveIdentityApproved: true }], liveExpected, 1000))
      .toMatchObject({ ok: true, value: { releaseAllowed: false, independentFactsReviewRequired: true } });
  });
  it("rejects contradictory cleanup/charge/provider facts", () => {
    for (const override of [{ observedState: "RUNNING" as const }, { noChargeConfirmed: true }, { providerIdentitySha256: null },
      { context: { ...context, kind: "META" as const } }]) {
      const raw = observation(override);
      expect(assessReconciliation(encodeReconciliation(raw), [key], { ...expected, context: raw.context }, 1000).ok).toBe(false);
    }
  });
});
describe("provider timing review never grants dispatch", () => {
  const valid = { invocationRemainingMs: 60000, leaseRemainingMs: 10000, operationTimeoutMs: 20000,
    storeBudgetMs: 7000, cleanupBudgetMs: 5000, safetyMarginMs: 1000 };
  it("rejects the current 5-second lease/7-second SQL/15-second invocation assumption", () => {
    expect(reviewProviderTiming({ ...valid, invocationRemainingMs: 15000, leaseRemainingMs: 5000 })).toEqual({ compatible: false, dispatchAllowed: false });
    expect(reviewProviderTiming(valid)).toEqual({ compatible: true, dispatchAllowed: false });
  });
  it.each([{ leaseRemainingMs: 7999 }, { invocationRemainingMs: 39999 }, { storeBudgetMs: 7001 }, { operationTimeoutMs: 0 }, { cleanupBudgetMs: -1 }, { invocationRemainingMs: Infinity }])("rejects unsafe/invalid bounds %o", override => {
    expect(reviewProviderTiming({ ...valid, ...override })).toEqual({ compatible: false, dispatchAllowed: false });
  });
});
