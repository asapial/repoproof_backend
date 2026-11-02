import { readFile } from "node:fs/promises";
import { parse } from "@babel/parser";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessResourceObservation, encodeResourceObservation, prepareResourceProbe, resourceBundleSha256, resourceFiles, resourceLimits,
  type ResourceBinding, type ResourceObservation, type ResourceScope } from "./resources";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const scope: ResourceScope = { sessionId: "synthetic-owned-session",executionId: "20000000-0000-4000-8000-000000000001",cgroupScopeSha256: "c".repeat(64) };
const binding = (mode: ResourceBinding["mode"]): ResourceBinding => ({ version: "rpf-resource-probe-v1",nonce: "10000000-0000-4000-8000-000000000001",mode,
  fixtureBundleSha256: resourceBundleSha256,imageDigest: "d".repeat(64),commandSha256: "e".repeat(64),inputSha256: "f".repeat(64) });
function fixture(mode: ResourceBinding["mode"] = "MEMORY_HARD_LIMIT"): ResourceObservation {
  return { version: "rpf-resource-observation-v1",source: "OFFLINE_SYNTHETIC",binding: binding(mode),scope: { ...scope },
    startedMarkerSeen: true,limitExceededMarkerSeen: false,workersStarted: mode === "CPU_PRESSURE" ? 2 : 0,cleanupConfirmed: true,
    sampleDurationMs: 4000,termination: mode === "CPU_PRESSURE" ? "PROVIDER_TIMEOUT" : "CGROUP_OOM_KILL",nodeHeapError: false,
    effectiveVcpus: 1,memoryMaxBytes: resourceLimits.memoryBytes,memoryPeakBytes: resourceLimits.memoryBytes-1048576,oomKillsBefore: 0,oomKillsAfter: 1,
    cpuQuotaMicros: 100000,cpuPeriodMicros: 100000,cpuBurstMicros: 0,cpuUsageMicrosBefore: 10000,cpuUsageMicrosAfter: 4010000,cpuThrottledMicrosBefore: 0,cpuThrottledMicrosAfter: 1000000 };
}
const assess = (o: ResourceObservation) => assessResourceObservation(encodeResourceObservation(o),binding(o.binding.mode),scope);
describe("owned hard-resource preparation, never executed probe code", () => {
  it("checks pinned source bytes and syntax without importing or running either probe", async () => {
    for (const [name,digest] of Object.entries(resourceFiles)) {
      const bytes = await readFile("fixtures/isolation-owned/"+name); expect(hash(bytes)).toBe(digest); expect(bytes.length).toBeLessThan(32768);
      const ast = parse(bytes.toString(),{ sourceType: "module",errorRecovery: false }); expect(ast.errors).toHaveLength(0);
      expect(bytes.toString()).toContain("Approved isolated guest required");
      expect(bytes.toString()).not.toMatch(/setTimeout|child_process|node:net|https?:\/\//);
    }
  });
  it.each(["MEMORY_HARD_LIMIT","CPU_PRESSURE"] as const)("prepares fixed %s commands with no execution permission or caller overrides", async mode => {
    const plan = await prepareResourceProbe(mode,"d".repeat(64));
    expect(plan).toMatchObject({ trust: "PREPARATION_ONLY",executionAllowed: false,limits: { vcpus: 1,memoryBytes: 2147483648,lifetimeMs: 30000,commandTimeoutMs: 5000,concurrency: 1 },
      command: { cmd: "node",cwd: "/vercel/sandbox",env: {},sudo: false,timeoutMs: 5000 } });
    expect(plan.command.args).toEqual([`/vercel/sandbox/isolation/${mode === "MEMORY_HARD_LIMIT" ? "resource-memory.mjs" : "resource-cpu.mjs"}`]);
    expect(hash(Buffer.from(JSON.stringify(["node",...plan.command.args])))).toBe(plan.binding.commandSha256);
    const input = plan.files.find(file => file.path === "/vercel/sandbox/resource-input.json")!;
    expect(hash(input.content)).toBe(plan.binding.inputSha256); expect(JSON.parse(input.content.toString())).toEqual({ version: "rpf-resource-probe-v1",nonce: plan.binding.nonce,mode });
    plan.files[0]!.content.fill(0); const another = await prepareResourceProbe(mode,"d".repeat(64));
    expect(hash(another.files[0]!.content)).toBe(resourceFiles["resource-cpu.mjs"]); expect(another.binding.nonce).not.toBe(plan.binding.nonce);
  });
  it("rejects unsupported mode/image values before asset preparation", async () => {
    await expect(prepareResourceProbe("arbitrary" as never,"d".repeat(64))).rejects.toThrow(); await expect(prepareResourceProbe("CPU_PRESSURE","latest")).rejects.toThrow();
  });
  it.each(["MEMORY_HARD_LIMIT","CPU_PRESSURE"] as const)("keeps well-shaped synthetic %s observations out of live review", mode => {
    expect(assess(fixture(mode))).toMatchObject({ facts: "MATCHED",readyForIndependentReview: false,authentic: false,rpf004Complete: false,reasons: ["SYNTHETIC_NOT_LIVE"] });
  });
  it("marks a consistent unverified observer claim for review but never authenticates or completes isolation", () => {
    const o = fixture(); o.source = "UNVERIFIED_OBSERVER_CLAIM";
    expect(assess(o)).toEqual({ facts: "MATCHED",reasons: [],readyForIndependentReview: true,authentic: false,rpf004Complete: false });
  });
  it.each([{ termination: "ALLOCATION_ERROR" },{ termination: "PROVIDER_TIMEOUT" },{ nodeHeapError: true },{ oomKillsAfter: 0 },{ oomKillsBefore: null },
    { memoryPeakBytes: null },{ memoryPeakBytes: 1000 },{ memoryPeakBytes: resourceLimits.memoryBytes+1 }])("does not mistake memory failure/timeout/ambiguous counters for a hard cap %j", changed => {
    expect(assess(Object.assign(fixture(),changed))).toMatchObject({ facts: "INSUFFICIENT",readyForIndependentReview: false });
  });
  it.each([{ workersStarted: 0 },{ sampleDurationMs: 2000 },{ cpuQuotaMicros: null },{ cpuPeriodMicros: null },{ cpuBurstMicros: 1 },{ cpuThrottledMicrosAfter: 0 },
    { cpuUsageMicrosAfter: 0 },{ cpuUsageMicrosAfter: 20000 },{ termination: "NORMAL_EXIT" }])("requires actual-shaped CPU pressure/quota/throttling observations %j", changed => {
    expect(assess(Object.assign(fixture("CPU_PRESSURE"),changed))).toMatchObject({ facts: "INSUFFICIENT",readyForIndependentReview: false });
  });
  it.each([{ startedMarkerSeen: false },{ cleanupConfirmed: false },{ effectiveVcpus: null },{ memoryMaxBytes: null },{ sampleDurationMs: 0 },{ sampleDurationMs: 5001 }])("requires positive controls, bounded observations and cleanup %j", changed => {
    expect(assess(Object.assign(fixture(),changed))).toMatchObject({ facts: "INSUFFICIENT",readyForIndependentReview: false });
  });
  it("detects claimed escaped limits and contradictory CPU usage", () => {
    for (const o of [Object.assign(fixture(),{ limitExceededMarkerSeen: true }),Object.assign(fixture(),{ effectiveVcpus: 2 }),Object.assign(fixture(),{ memoryMaxBytes: 3*1024*1024*1024 }),
      Object.assign(fixture("CPU_PRESSURE"),{ cpuQuotaMicros: 200000 }),Object.assign(fixture("CPU_PRESSURE"),{ cpuUsageMicrosAfter: 5000000 })]) expect(assess(o)).toMatchObject({ facts: "CONTRADICTORY",readyForIndependentReview: false,authentic: false,rpf004Complete: false });
  });
  it.each(["nonce","imageDigest","commandSha256","inputSha256","fixtureBundleSha256"] as const)("requires exact %s binding", field => {
    const o = fixture(); o.binding[field] = field === "nonce" ? scope.executionId : "0".repeat(64);
    expect(assessResourceObservation(encodeResourceObservation(o),binding("MEMORY_HARD_LIMIT"),scope)).toMatchObject({ facts: "INSUFFICIENT",reasons: ["PROVENANCE_MISMATCH"] });
  });
  it("requires independent session/execution/cgroup scope consistency", () => {
    for (const changed of [{ sessionId: "other" },{ executionId: binding("CPU_PRESSURE").nonce },{ cgroupScopeSha256: "0".repeat(64) }]) {
      const o = fixture(); Object.assign(o.scope,changed); expect(assess(o)).toMatchObject({ facts: "INSUFFICIENT",reasons: ["PROVENANCE_MISMATCH"] });
    }
  });
  it("rejects duplicate/prototype/noncanonical/malformed/excess evidence without returning supplied data", () => {
    const encoded = encodeResourceObservation(fixture());
    for (const bytes of [Buffer.from(" "+encoded),Buffer.from(encoded.toString().replace('"version":','"version":"duplicate","version":')),
      Buffer.from(encoded.toString().replace('"source":','"__proto__":{},"source":')),Buffer.from(encoded.toString().replace('"source":','"verdict":"VERIFIED","source":')),
      Buffer.from(encoded.toString().replace('"oomKillsAfter":1','"oomKillsAfter":-1')),Buffer.alloc(16385),Uint8Array.of(0xff)]) {
      expect(assessResourceObservation(bytes,binding("MEMORY_HARD_LIMIT"),scope)).toEqual({ facts: "INSUFFICIENT",reasons: ["MALFORMED"],readyForIndependentReview: false,authentic: false,rpf004Complete: false });
    }
  });
});
