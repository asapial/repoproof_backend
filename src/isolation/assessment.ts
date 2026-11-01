import { createPublicKey, verify, createHash } from "node:crypto";
import { z } from "zod";

// Deliberately independent of the smoke SDK/schema and product verdict policy.
export const isolationGates = ["EXTERNAL_V4", "PRIVATE_V4", "METADATA", "IPV6", "APP_SECRETS", "FILESYSTEM", "CROSS_SANDBOX", "RESOURCES", "TIMEOUT", "CANCELLATION_CLEANUP", "NONPERSISTENCE", "PROVENANCE", "FAILURE_PATH"] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const observationSchema = z.object({ evidenceId: uuid, auditId: uuid, nonce: digest, role: z.enum(["controller", "observer"]), keyId: id,
  source: z.enum(["LIVE_PROVIDER", "OFFLINE_SYNTHETIC"]), issuedAtMs: z.number().int().nonnegative().safe(), expiresAtMs: z.number().int().positive().safe(),
  fixtureBundleSha256: digest, imageDigest: digest, sessionIds: z.array(id).min(1).max(20),
  gates: z.array(z.object({ id: z.enum(isolationGates), outcome: z.enum(["PASS", "FAIL", "UNKNOWN"]), factsSha256: digest }).strict()).max(isolationGates.length),
  cleanupConfirmed: z.boolean(), signature: z.string().regex(/^[a-f0-9]{128}$/),
}).strict();
export type IsolationObservation = z.infer<typeof observationSchema>;
export type IsolationTrustKey = { role: "controller" | "observer"; keyId: string; publicKeyPem: string; liveIdentityApproved: boolean };
export interface IsolationReplayStore { consume(input: { evidenceIds: [string,string]; nonces: [string,string]; auditId: string; expiresAtMs: number }): Promise<boolean> }
export function isolationSigningBytes(value: Omit<IsolationObservation, "signature">): Buffer {
  return Buffer.from(JSON.stringify(["repoproof.isolation.v1", value.evidenceId,value.auditId,value.nonce,value.role,value.keyId,value.source,value.issuedAtMs,value.expiresAtMs,value.fixtureBundleSha256,value.imageDigest,[...value.sessionIds].sort(),[...value.gates].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(gate => [gate.id,gate.outcome,gate.factsSha256]),value.cleanupConfirmed]), "utf8");
}
export type IsolationAssessment = { status: "INCOMPLETE" | "FAILED" | "READY_FOR_INDEPENDENT_REVIEW"; reasons: string[]; rpf004Complete: false };
const incomplete = (...reasons: string[]): IsolationAssessment => ({ status: "INCOMPLETE", reasons, rpf004Complete: false });
export async function assessIsolation(inputBytes: Uint8Array, keys: readonly IsolationTrustKey[], replay: IsolationReplayStore | null,
  expected: { auditId: string; fixtureBundleSha256: string; imageDigest: string; sessionIds: readonly string[]; twoSandboxApproved: boolean }, nowMs: number): Promise<IsolationAssessment> {
  if (inputBytes.byteLength === 0 || inputBytes.byteLength > 65536 || !Number.isSafeInteger(nowMs) || nowMs < 0 || !replay) return incomplete("BOUNDARY_OR_REPLAY_UNAVAILABLE");
  if (!expected.twoSandboxApproved || expected.sessionIds.length < 2 || expected.sessionIds.length > 20 || new Set(expected.sessionIds).size !== expected.sessionIds.length) return incomplete("CROSS_SANDBOX_APPROVAL_OR_SESSIONS_MISSING");
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes)); } catch { return incomplete("INVALID_JSON"); }
  const parsed = z.tuple([observationSchema,observationSchema]).safeParse(decoded);
  if (!parsed.success) return incomplete("INVALID_OBSERVATION");
  const observations = parsed.data;
  if (observations[0].role === observations[1].role || observations[0].evidenceId === observations[1].evidenceId || observations[0].nonce === observations[1].nonce) return incomplete("IDENTITIES_NOT_INDEPENDENT");
  const fingerprints: string[] = [];
  for (const observation of observations) {
    if (observation.auditId !== expected.auditId || observation.fixtureBundleSha256 !== expected.fixtureBundleSha256 || observation.imageDigest !== expected.imageDigest ||
      new Set(observation.sessionIds).size !== observation.sessionIds.length || JSON.stringify([...observation.sessionIds].sort()) !== JSON.stringify([...expected.sessionIds].sort()) ||
      observation.issuedAtMs > nowMs || observation.expiresAtMs <= nowMs || observation.expiresAtMs <= observation.issuedAtMs || observation.expiresAtMs - observation.issuedAtMs > 300000) return incomplete("PROVENANCE_OR_TIME_MISMATCH");
    const matching = keys.filter(key => key.role === observation.role && key.keyId === observation.keyId);
    if (matching.length !== 1 || !matching[0]?.liveIdentityApproved || matching[0].publicKeyPem.length > 8192 || observation.source !== "LIVE_PROVIDER") return incomplete("LIVE_TRUST_ROOT_UNAVAILABLE");
    try {
      const publicKey = createPublicKey(matching[0].publicKeyPem);
      if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, isolationSigningBytes(observation), publicKey, Buffer.from(observation.signature, "hex"))) return incomplete("INVALID_SIGNATURE");
      fingerprints.push(createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex"));
    } catch { return incomplete("INVALID_TRUST_KEY"); }
    if (new Set(observation.gates.map(gate => gate.id)).size !== observation.gates.length || isolationGates.some(id => !observation.gates.some(gate => gate.id === id)) || !observation.cleanupConfirmed) return incomplete("MANDATORY_GATES_OR_CLEANUP_MISSING");
  }
  if (new Set(fingerprints).size !== 2) return incomplete("KEYS_NOT_INDEPENDENT");
  const failed = observations.flatMap(observation => observation.gates.filter(gate => gate.outcome === "FAIL").map(gate => gate.id));
  if (failed.length) return { status: "FAILED", reasons: [...new Set(failed)], rpf004Complete: false };
  if (observations.some(observation => observation.gates.some(gate => gate.outcome !== "PASS"))) return incomplete("UNTESTED_OR_AMBIGUOUS_GATES");
  for (const gate of observations[0].gates) if (observations[1].gates.find(item => item.id === gate.id)?.factsSha256 !== gate.factsSha256) return incomplete("OBSERVATIONS_DISAGREE");
  try {
    const accepted = await replay.consume({ auditId: expected.auditId, evidenceIds: [observations[0].evidenceId,observations[1].evidenceId], nonces: [observations[0].nonce,observations[1].nonce], expiresAtMs: Math.min(...observations.map(item => item.expiresAtMs)) });
    if (!accepted) return incomplete("REPLAY_REJECTED");
  } catch { return incomplete("REPLAY_UNAVAILABLE"); }
  // This validates signed statements, not the facts they assert. A separately
  // approved live observer/evidence review must still establish their truth.
  return { status: "READY_FOR_INDEPENDENT_REVIEW", reasons: [], rpf004Complete: false };
}
