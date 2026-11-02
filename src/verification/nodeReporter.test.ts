import { describe, expect, it } from "vitest";
import { assertionBlueprintSha256, assertionMarker, encodeAssertionEvent, type AssertionBlueprint, type AssertionEvent } from "./assertionCounter";
import { createOwnedNodeReporter, OwnedNodeEventCollector } from "./nodeReporter";
import { OwnedReporterCollector, reporterPlanSha256 } from "./reporter";

const blueprint = (): AssertionBlueprint => ({ version: "rpf-assertion-blueprint-v1",expectedFile: "/owned/trusted-node-self-test.mjs",tests: [{ index: 1,name: "trusted numeric",assertions: 2 }],
  reporter: { version: "rpf-reporter-v1",assertionsPerTest: [2],plan: { provenance: "SYNTHETIC_OFFLINE_FIXTURE",expectedTests: 1,expectedAssertions: 2,maxDurationMs: 5000,
    binding: { runId: "10000000-0000-4000-8000-000000000001",executionId: "10000000-0000-4000-8000-000000000002",stage: "BASELINE",suite: "ISSUE",baseSha: "a".repeat(40),
      frozenManifestSha256: "b".repeat(64),snapshotSha256: "c".repeat(64),testSha256: "d".repeat(64),runnerImageDigest: "e".repeat(64),commandManifestSha256: "f".repeat(64) } } } });
function events(p: AssertionBlueprint, failed = false): { type: string;data: Record<string,unknown> }[] {
  const diagnostic = (assertion: number,outcome: AssertionEvent["outcome"]) => ({ type: "test:diagnostic",data: { file: p.expectedFile,nesting: 0,
    message: assertionMarker+encodeAssertionEvent({ version: "rpf-assertion-v1",blueprintSha256: assertionBlueprintSha256(p),planSha256: reporterPlanSha256(p.reporter),index: 1,assertion,outcome }) } });
  return [{ type: failed ? "test:fail" : "test:pass",data: { file: p.expectedFile,name: p.tests[0]!.name,nesting: 0,details: failed ? { error: { cause: { code: "ERR_ASSERTION" } } } : {} } },
    diagnostic(1,"PASSED"),diagnostic(2,failed ? "FAILED" : "PASSED"),{ type: "test:summary",data: { success: !failed,counts: { tests: 1,passed: failed ? 0 : 1,failed: failed ? 1 : 0,skipped: 0,cancelled: 0,todo: 0,suites: 0,topLevel: 1 } } }];
}
function consume(input: unknown[],p = blueprint()) { const c = new OwnedNodeEventCollector(p); for (const event of input) c.write(event); return c.finish(); }
function decoded(input: unknown[],failed = false) {
  const p = blueprint(), result = consume(input,p); if (!result.ok) throw new Error(result.reason);
  const c = new OwnedReporterCollector(p.reporter); expect(c.write(result.bytes)).toBe(true);
  return c.finish({ startedAtMs: 1000,finishedAtMs: 1010,exitCode: failed ? 1 : 0,timedOut: false,setupFailure: false,
    stdoutSha256: "1".repeat(64),stderrSha256: "2".repeat(64),artifactManifestSha256: p.reporter.plan.binding.snapshotSha256 });
}
describe("owned native-event adapter (inert synthetic objects only)", () => {
  it("joins buffered diagnostics after native result and keeps both pass/fail unauthenticated", () => {
    expect(decoded(events(blueprint()))).toMatchObject({ ok: true,value: { authentic: false,decoded: { classification: "PASS",authentic: false } } });
    expect(decoded(events(blueprint(),true),true)).toMatchObject({ ok: true,value: { authentic: false,decoded: { classification: "ASSERTION_FAILURE" } } });
  });
  it("does not accept forged stdout or a native pass without explicit counters", () => {
    const input = events(blueprint()); input[1]!.type = "test:stdout"; input[2]!.type = "test:stdout";
    expect(consume(input)).toEqual({ ok: false,reason: "COUNTER_MISMATCH" }); expect(consume([input[0],input[3]])).toEqual({ ok: false,reason: "COUNTER_MISMATCH" });
  });
  it.each(["duplicate","binding","sequence","file","nativeDuplicate","summary","missingSummary","unknown","rerun"])("rejects %s inconsistency", changed => {
    const input = events(blueprint());
    if (changed === "duplicate") input.splice(2,0,input[1]!);
    if (changed === "binding") input[1]!.data.message = (input[1]!.data.message as string).replace(assertionBlueprintSha256(blueprint()),"0".repeat(64));
    if (changed === "sequence") input.splice(1,1);
    if (changed === "file") input[1]!.data.file = "/other";
    if (changed === "nativeDuplicate") input.splice(1,0,input[0]!);
    if (changed === "summary") (input[3]!.data.counts as Record<string,unknown>).tests = 0;
    if (changed === "missingSummary") input.pop();
    if (changed === "unknown") input[0]!.type = "test:watch:restarted";
    if (changed === "rerun") (input[0]!.data.details as Record<string,unknown>).attempt = 2;
    expect(consume(input).ok).toBe(false);
  });
  it("preserves non-assertion native failures as inconclusive and rejects contradictory counter failures", () => {
    const input = events(blueprint(),true); input.splice(1,2); input[0]!.data.details = { error: { cause: { code: "ERR_MODULE_NOT_FOUND" } } };
    expect(decoded(input,true)).toMatchObject({ ok: true,value: { decoded: { classification: "INCONCLUSIVE",receipt: { counts: { assertionsFailed: 0 } } } } });
    const contradictory = events(blueprint(),true); contradictory[0]!.data.details = { error: { cause: { code: "ERR_MODULE_NOT_FOUND" } } };
    expect(consume(contradictory)).toEqual({ ok: false,reason: "COUNTER_MISMATCH" });
  });
  it("does not promote skipped, zero or partial native runs into a passing receipt", () => {
    const skipped = events(blueprint()); skipped.splice(1,2); skipped[0]!.data.skip = true;
    Object.assign(skipped[1]!.data.counts as object,{ passed: 0,skipped: 1 });
    const result = decoded(skipped);
    expect(result.ok && result.value.decoded.classification).not.toBe("PASS");
    expect(consume([events(blueprint())[0]])).toEqual({ ok: false,reason: "NATIVE_INCOMPLETE" });
    const zero = events(blueprint()).at(-1)!;
    Object.assign(zero.data.counts as object,{ tests: 0,passed: 0,topLevel: 0 });
    const empty = decoded([zero]);
    expect(empty.ok && empty.value.decoded.classification).not.toBe("PASS");
  });
  it("rejects noncanonical diagnostics and failed counters contradicting a native pass", () => {
    const input = events(blueprint());
    input[1]!.data.message = (input[1]!.data.message as string).replace(assertionMarker,assertionMarker+" ");
    expect(consume(input)).toEqual({ ok: false,reason: "COUNTER_EVENT" });
    const contradictory = events(blueprint(),true); contradictory[0]!.type = "test:pass";
    Object.assign(contradictory[3]!.data,{ success: true });
    Object.assign(contradictory[3]!.data.counts as object,{ passed: 1,failed: 0 });
    expect(consume(contradictory)).toEqual({ ok: false,reason: "COUNTER_MISMATCH" });
  });
  it("bounds event/output sizes and closes one-shot with fixed errors", async () => {
    const p = blueprint(), c = new OwnedNodeEventCollector(p); c.write({ type: "test:stdout",data: { message: "x".repeat(16385) } });
    expect(c.finish()).toEqual({ ok: false,reason: "NATIVE_LIMIT" }); expect(c.finish()).toEqual({ ok: false,reason: "CLOSED" });
    expect(consume(Array.from({ length: 4097 },() => ({ type: "test:start",data: {} })))).toEqual({ ok: false,reason: "NATIVE_LIMIT" });
    const chunks: Buffer[] = [];
    for await (const chunk of createOwnedNodeReporter(p)((async function* () { for (const event of events(p)) yield event; })())) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    let yieldedBytes = 0;
    await expect((async () => { for await (const chunk of createOwnedNodeReporter(p)((async function* () { yield { type: "bad",data: {} }; })())) yieldedBytes += chunk.byteLength; })()).rejects.toThrow("OWNED_NODE_REPORTER_UNAVAILABLE");
    expect(yieldedBytes).toBe(0);
  });
});
