import { createHash, randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { z } from "zod";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const resourceFiles = Object.freeze({
  "resource-cpu.mjs": "32a67814d941beb09fb2c39081a25bdd5bc971193aece3557102341daeedcd21",
  "resource-memory.mjs": "b171d55df9b35566d43a8b8a4fea1e9c42559779642b9428f5de1853ed57805a",
});
export const resourceBundleSha256 = hash(Buffer.from(JSON.stringify(resourceFiles)));
export const resourceLimits = Object.freeze({ vcpus: 1,memoryBytes: 2*1024*1024*1024,lifetimeMs: 30000,commandTimeoutMs: 5000,
  outputBytes: 16384,concurrency: 1,memoryProbeMaximumBytes: 3*1024*1024*1024,memoryChunkBytes: 64*1024*1024,cpuWorkers: 2 });
const digest = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid().regex(/^[a-f0-9-]+$/), count = z.number().int().nonnegative().safe();
const modeSchema = z.enum(["MEMORY_HARD_LIMIT","CPU_PRESSURE"]);
const bindingSchema = z.object({ version: z.literal("rpf-resource-probe-v1"),nonce: uuid,mode: modeSchema,
  fixtureBundleSha256: digest,imageDigest: digest,commandSha256: digest,inputSha256: digest }).strict();
export type ResourceBinding = z.infer<typeof bindingSchema>;
export async function prepareResourceProbe(mode: z.infer<typeof modeSchema>, imageDigest: string) {
  modeSchema.parse(mode); digest.parse(imageDigest);
  const root = "fixtures/isolation-owned", rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("RESOURCE_ASSET_UNAVAILABLE");
  const files: { path: string;content: Buffer }[] = [];
  for (const [name,expected] of Object.entries(resourceFiles)) {
    const path = `${root}/${name}`, stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw new Error("RESOURCE_ASSET_UNAVAILABLE");
    const content = await readFile(path); if (content.length > 32768 || hash(content) !== expected) throw new Error("RESOURCE_ASSET_INTEGRITY");
    files.push({ path: `/vercel/sandbox/isolation/${name}`,content });
  }
  const nonce = randomUUID(), input = Buffer.from(JSON.stringify({ version: "rpf-resource-probe-v1",nonce,mode }));
  const args = [`/vercel/sandbox/isolation/${mode === "MEMORY_HARD_LIMIT" ? "resource-memory.mjs" : "resource-cpu.mjs"}`];
  const binding = bindingSchema.parse({ version: "rpf-resource-probe-v1",nonce,mode,fixtureBundleSha256: resourceBundleSha256,imageDigest,
    commandSha256: hash(Buffer.from(JSON.stringify(["node",...args]))),inputSha256: hash(input) });
  return { trust: "PREPARATION_ONLY" as const,executionAllowed: false as const,binding: Object.freeze(binding),limits: resourceLimits,
    command: { cmd: "node" as const,args,cwd: "/vercel/sandbox",env: {},sudo: false as const,timeoutMs: resourceLimits.commandTimeoutMs },
    files: [...files,{ path: "/vercel/sandbox/resource-input.json",content: input }] };
}
const nullableCount = count.nullable();
const scopeSchema = z.object({ sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),executionId: uuid,cgroupScopeSha256: digest }).strict();
export type ResourceScope = z.infer<typeof scopeSchema>;
export const resourceObservationSchema = z.object({ version: z.literal("rpf-resource-observation-v1"),
  source: z.enum(["OFFLINE_SYNTHETIC","UNVERIFIED_OBSERVER_CLAIM"]),binding: bindingSchema,scope: scopeSchema,
  startedMarkerSeen: z.boolean(),limitExceededMarkerSeen: z.boolean(),workersStarted: count.max(2),cleanupConfirmed: z.boolean(),
  sampleDurationMs: count.max(30000),termination: z.enum(["CGROUP_OOM_KILL","PROVIDER_TIMEOUT","ALLOCATION_ERROR","NORMAL_EXIT","UNKNOWN"]),nodeHeapError: z.boolean(),
  effectiveVcpus: count.max(256).nullable(),memoryMaxBytes: nullableCount,memoryPeakBytes: nullableCount,oomKillsBefore: nullableCount,oomKillsAfter: nullableCount,
  cpuQuotaMicros: nullableCount,cpuPeriodMicros: nullableCount,cpuBurstMicros: nullableCount,cpuUsageMicrosBefore: nullableCount,cpuUsageMicrosAfter: nullableCount,
  cpuThrottledMicrosBefore: nullableCount,cpuThrottledMicrosAfter: nullableCount }).strict();
export type ResourceObservation = z.infer<typeof resourceObservationSchema>;
export function encodeResourceObservation(input: ResourceObservation): Buffer { return Buffer.from(JSON.stringify(resourceObservationSchema.parse(input))); }
export type ResourceAssessment = Readonly<{ facts: "MATCHED" | "CONTRADICTORY" | "INSUFFICIENT";reasons: readonly string[];
  readyForIndependentReview: boolean;authentic: false;rpf004Complete: false }>;
const result = (facts: ResourceAssessment["facts"],reason: string,liveClaim = false): ResourceAssessment => Object.freeze({ facts,reasons: Object.freeze(reason ? [reason] : []),
  readyForIndependentReview: facts === "MATCHED" && liveClaim,authentic: false,rpf004Complete: false });

/** Consistency of claimed subfacts only. No SDK, signature authority or gate pass. */
export function assessResourceObservation(input: Uint8Array, expectedBinding: ResourceBinding, expectedScope: ResourceScope): ResourceAssessment {
  let observation: ResourceObservation;
  try {
    if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 16384) throw new Error();
    const bytes = Buffer.from(input), text = new TextDecoder("utf-8",{ fatal: true,ignoreBOM: true }).decode(bytes);
    observation = resourceObservationSchema.parse(JSON.parse(text));
    const binding = bindingSchema.parse(expectedBinding), scope = scopeSchema.parse(expectedScope);
    if (!bytes.equals(encodeResourceObservation(observation))) throw new Error();
    if (JSON.stringify(observation.binding) !== JSON.stringify(binding) || JSON.stringify(observation.scope) !== JSON.stringify(scope) || binding.fixtureBundleSha256 !== resourceBundleSha256) return result("INSUFFICIENT","PROVENANCE_MISMATCH");
  } catch { return result("INSUFFICIENT","MALFORMED"); }
  const o = observation;
  if (o.limitExceededMarkerSeen) return result("CONTRADICTORY","LIMIT_EXCEEDED_MARKER");
  if ((o.effectiveVcpus !== null && o.effectiveVcpus !== resourceLimits.vcpus) || (o.memoryMaxBytes !== null && o.memoryMaxBytes !== resourceLimits.memoryBytes)) return result("CONTRADICTORY","ALLOCATION_MISMATCH");
  if (!o.startedMarkerSeen || !o.cleanupConfirmed || o.effectiveVcpus === null || o.memoryMaxBytes === null || !o.sampleDurationMs || o.sampleDurationMs > resourceLimits.commandTimeoutMs) return result("INSUFFICIENT","CONTROL_OR_CLEANUP_MISSING");
  if (o.binding.mode === "MEMORY_HARD_LIMIT") {
    if (o.termination !== "CGROUP_OOM_KILL" || o.nodeHeapError || o.memoryPeakBytes === null || o.oomKillsBefore === null || o.oomKillsAfter === null || o.oomKillsAfter <= o.oomKillsBefore) return result("INSUFFICIENT","HARD_MEMORY_ENFORCEMENT_UNOBSERVED");
    if (o.memoryPeakBytes < resourceLimits.memoryBytes*0.75 || o.memoryPeakBytes > resourceLimits.memoryBytes) return result("INSUFFICIENT","MEMORY_PEAK_REQUIRES_REVIEW");
  } else {
    const { cpuQuotaMicros: quota,cpuPeriodMicros: period,cpuBurstMicros: burst,cpuUsageMicrosBefore: before,cpuUsageMicrosAfter: after,
      cpuThrottledMicrosBefore: throttleBefore,cpuThrottledMicrosAfter: throttleAfter } = o;
    if (quota !== null && period !== null && period > 0 && quota > period) return result("CONTRADICTORY","CPU_QUOTA_EXCEEDS_ONE");
    if (o.termination !== "PROVIDER_TIMEOUT" || o.workersStarted !== 2 || o.sampleDurationMs < 3000 || quota === null || period === null || quota <= 0 || quota !== period || burst !== 0 ||
      before === null || after === null || after < before || throttleBefore === null || throttleAfter === null || throttleAfter <= throttleBefore) return result("INSUFFICIENT","CPU_ENFORCEMENT_UNOBSERVED");
    const used = after-before, wall = o.sampleDurationMs*1000;
    if (used > wall+quota) return result("CONTRADICTORY","CPU_USAGE_EXCEEDS_WINDOW_QUOTA");
    if (used < wall*0.5) return result("INSUFFICIENT","CPU_PRESSURE_UNCONFIRMED");
  }
  return result("MATCHED",o.source === "OFFLINE_SYNTHETIC" ? "SYNTHETIC_NOT_LIVE" : "",o.source === "UNVERIFIED_OBSERVER_CLAIM");
}
