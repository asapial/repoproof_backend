import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { fixtureDigests, fixturePin } from "./fixture";
import { smokeLimits } from "./policy";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const iso = z.iso.datetime();
export const smokeObservationSchema = z.object({ sandboxName: identity, sessionId: identity,
  image: z.string().regex(/^[a-z0-9][a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/),
  networkPolicy: z.enum(["deny-all", "allow-all", "custom"]), persistent: z.boolean(), vcpus: z.number().int().min(1).max(32), memoryMb: z.number().int().min(1).max(65536),
  timeoutMs: z.number().int().min(1).max(86400000), createdAt: iso,
}).strict();
export const smokeCommandSchema = z.object({ commandId: z.enum(["runtime", "hash_before", "issue", "regressions", "hash_after"]), argvSha256: digest,
  startedAt: iso, finishedAt: iso, exitCode: z.number().int().min(0).max(255).nullable(),
  stdoutBytes: z.number().int().nonnegative(), stderrBytes: z.number().int().nonnegative(), stdoutSha256: digest, stderrSha256: digest,
}).strict();
export type SmokeCommandReceipt = z.infer<typeof smokeCommandSchema>;
export const smokeReceiptSchema = z.object({ version: z.literal("owned-smoke-v1"), observationId: z.string().uuid(),
  trust: z.literal("UNVERIFIED_SDK_OBSERVATION"), startedAt: iso, finishedAt: iso, fixturePin: z.literal(fixturePin),
  fixtureManifestSha256: digest, requestedPolicySha256: digest, provider: smokeObservationSchema.nullable(),
  commands: z.array(smokeCommandSchema).max(5), cleanup: z.object({ attemptedAt: iso.nullable(), acknowledgedAt: iso.nullable(),
    status: z.enum(["NOT_CREATED", "STOPPED", "UNKNOWN"]), snapshotCreated: z.boolean().nullable() }).strict(),
}).strict();
export type SmokeReceipt = z.infer<typeof smokeReceiptSchema>;
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function newSmokeReceipt(image: string): SmokeReceipt {
  return { version: "owned-smoke-v1", observationId: randomUUID(), trust: "UNVERIFIED_SDK_OBSERVATION", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    fixturePin, fixtureManifestSha256: hash(JSON.stringify({ fixturePin, sha256: fixtureDigests })),
    requestedPolicySha256: hash(JSON.stringify({ image, networkPolicy: "deny-all", persistent: false, vcpus: 1, memoryMb: 2048, timeoutMs: smokeLimits.lifetimeMs, ports: [], env: {}, mounts: {} })),
    provider: null, commands: [], cleanup: { attemptedAt: null, acknowledgedAt: null, status: "NOT_CREATED", snapshotCreated: null } };
}
export function sanitizeSmokeObservation(value: unknown, expectedImage: string, secrets: readonly string[]) {
  const parsed = smokeObservationSchema.safeParse(value);
  if (!parsed.success || parsed.data.image !== expectedImage || secrets.some(secret => secret.length > 0 && JSON.stringify(parsed.data).includes(secret))) throw new Error("Sandbox observation unavailable");
  return parsed.data;
}
