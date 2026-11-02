import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const milliseconds = z.number().int().nonnegative().safe();
export const reconciliationContextSchema = z.object({ jobId: uuid, effectId: uuid, jobVersion: z.number().int().nonnegative(),
  kind: z.enum(["META", "SANDBOX"]), requestHash: digest, state: z.literal("QUARANTINED"),
  cancelRequested: z.boolean(), deadlineAtMs: milliseconds }).strict();
export type ReconciliationContext = z.infer<typeof reconciliationContextSchema>;
const source = z.enum(["OFFLINE_SYNTHETIC", "LIVE_PROVIDER"]);
const unsignedSchema = z.object({ version: z.literal("rpf-reconciliation-v1"), evidenceId: uuid, context: reconciliationContextSchema,
  source, keyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), observedAtMs: milliseconds, expiresAtMs: milliseconds,
  observedState: z.enum(["UNKNOWN", "NOT_FOUND", "RUNNING", "STOPPED", "COMPLETED", "FAILED", "CANCELLED"]),
  providerIdentitySha256: digest.nullable(), cleanupConfirmed: z.boolean(), noChargeConfirmed: z.boolean(), factsSha256: digest }).strict();
const observationSchema = unsignedSchema.extend({ signature: z.string().regex(/^[a-f0-9]{128}$/) }).strict();
export type ReconciliationObservation = z.infer<typeof observationSchema>;
export type ReconciliationTrustKey = { keyId: string; purpose: "reconciliation-observer"; publicKeyPem: string; liveIdentityApproved: boolean };
export type AcceptedReconciliation = Readonly<{ evidenceId: string; payloadSha256: string; observerFingerprint: string;
  source: "OFFLINE_SYNTHETIC" | "LIVE_PROVIDER"; decision: "KEEP_QUARANTINED";
  redispatchAllowed: false; releaseAllowed: false; independentFactsReviewRequired: true }>;
const records = new WeakMap<AcceptedReconciliation, ReconciliationObservation>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function reconciliationSigningBytes(input: Omit<ReconciliationObservation, "signature">): Buffer {
  return Buffer.from(JSON.stringify(["repoproof.reconciliation.v1", unsignedSchema.parse(input)]));
}
export function encodeReconciliation(input: ReconciliationObservation): Buffer {
  return Buffer.from(JSON.stringify(observationSchema.parse(input)));
}
export function assessReconciliation(bytes: Uint8Array, keys: readonly ReconciliationTrustKey[],
  expected: { context: ReconciliationContext; source: ReconciliationObservation["source"]; dispatcherFingerprint: string }, nowMs: number):
  { ok: true; value: AcceptedReconciliation } | { ok: false; reason: "INVALID" | "BINDING_OR_TIME" | "TRUST_OR_SIGNATURE" } {
  let observation: ReconciliationObservation, copy: Buffer;
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 16384 || !Number.isSafeInteger(nowMs) || nowMs < 0) return { ok: false, reason: "INVALID" };
    copy = Buffer.from(bytes);
    observation = observationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy)));
    if (!copy.equals(Buffer.from(JSON.stringify(observation)))) return { ok: false, reason: "INVALID" };
    const context = reconciliationContextSchema.parse(expected.context);
    if (JSON.stringify(context) !== JSON.stringify(observation.context) || observation.source !== expected.source ||
      observation.observedAtMs > nowMs || observation.expiresAtMs <= nowMs || observation.expiresAtMs <= observation.observedAtMs ||
      observation.expiresAtMs - observation.observedAtMs > 300000) return { ok: false, reason: "BINDING_OR_TIME" };
    if ((observation.cleanupConfirmed && (context.kind !== "SANDBOX" || !["STOPPED", "CANCELLED"].includes(observation.observedState))) ||
      (observation.noChargeConfirmed && (context.kind !== "META" || !["COMPLETED", "FAILED", "CANCELLED"].includes(observation.observedState))) ||
      (!observation.providerIdentitySha256 && !["UNKNOWN", "NOT_FOUND"].includes(observation.observedState))) return { ok: false, reason: "INVALID" };
    const matches = keys.filter(key => key.keyId === observation.keyId && key.purpose === "reconciliation-observer");
    if (matches.length !== 1 || !digest.safeParse(expected.dispatcherFingerprint).success || !matches[0] ||
      matches[0].publicKeyPem.length > 8192 || (observation.source === "LIVE_PROVIDER" && !matches[0].liveIdentityApproved)) return { ok: false, reason: "TRUST_OR_SIGNATURE" };
    const publicKey = createPublicKey(matches[0].publicKeyPem);
    const fingerprint = hash(publicKey.export({ type: "spki", format: "der" }));
    const { signature, ...unsigned } = observation;
    if (fingerprint === expected.dispatcherFingerprint || publicKey.asymmetricKeyType !== "ed25519" ||
      !verify(null, reconciliationSigningBytes(unsigned), publicKey, Buffer.from(signature, "hex"))) return { ok: false, reason: "TRUST_OR_SIGNATURE" };
    Object.freeze(observation.context); Object.freeze(observation);
    const accepted = Object.freeze({ evidenceId: observation.evidenceId, payloadSha256: hash(copy), observerFingerprint: fingerprint,
      source: observation.source, decision: "KEEP_QUARANTINED" as const, redispatchAllowed: false as const, releaseAllowed: false as const,
      independentFactsReviewRequired: true as const });
    records.set(accepted, observation);
    return { ok: true, value: accepted };
  } catch { return { ok: false, reason: "INVALID" }; }
}

// Persistence can access only a cryptographically checked in-process capability.
// This verifies a signature's author, not the truth of independent provider facts.
export function reconciliationRecord(handle: AcceptedReconciliation): ReconciliationObservation {
  const record = records.get(handle);
  if (!record) throw new Error("INVALID_RECONCILIATION");
  return { ...record, context: { ...record.context } };
}

const timingSchema = z.object({ invocationRemainingMs: z.number().int().positive().max(300000), leaseRemainingMs: milliseconds,
  operationTimeoutMs: z.number().int().positive().max(300000), storeBudgetMs: z.number().int().positive().max(7000),
  cleanupBudgetMs: z.number().int().positive().max(300000), safetyMarginMs: z.number().int().positive().max(300000) }).strict();
/** A timing review, never dispatch permission. Existing provider activation stays disabled. */
export function reviewProviderTiming(input: z.infer<typeof timingSchema>): { compatible: boolean; dispatchAllowed: false } {
  const parsed = timingSchema.safeParse(input);
  if (!parsed.success) return { compatible: false, dispatchAllowed: false };
  const p = parsed.data;
  // The lease covers durable intent reservation. Quarantine, not an expired
  // lease, holds the slot across the provider operation and reconciliation.
  const reserveFits = p.leaseRemainingMs >= p.storeBudgetMs + p.safetyMarginMs;
  const invocationFits = p.invocationRemainingMs >= 2 * p.storeBudgetMs + p.operationTimeoutMs + p.cleanupBudgetMs + p.safetyMarginMs;
  return { compatible: reserveFits && invocationFits, dispatchAllowed: false };
}
