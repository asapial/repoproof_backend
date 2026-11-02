import { createHash } from "node:crypto";
import { z } from "zod";
import { decodeExecutionReceipt, encodeExecutionReceipt, executionPlanSchema, executionReceiptSchema, type DecodedExecution, type ExecutionPlan, type ExecutionReceipt } from "./results";

const sequence = z.number().int().min(1).max(1200), index = z.number().int().min(1).max(16);
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START"), seq: sequence, planSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal("TEST_START"), seq: sequence, index }).strict(),
  z.object({ type: z.literal("ASSERTION"), seq: sequence, index, assertion: z.number().int().min(1).max(32), outcome: z.enum(["PASSED", "FAILED"]) }).strict(),
  z.object({ type: z.literal("TEST_END"), seq: sequence, index, outcome: z.enum(["PASSED", "FAILED", "SKIPPED"]),
    failureKind: z.enum(["ASSERTION", "SETUP", "IMPORT", "SYNTAX", "UNKNOWN"]).nullable() }).strict(),
  z.object({ type: z.literal("END"), seq: sequence }).strict(),
]);
export type ReporterEvent = z.infer<typeof eventSchema>;
export const reportPlanSchema = z.object({ version: z.literal("rpf-reporter-v1"), plan: executionPlanSchema,
  assertionsPerTest: z.array(z.number().int().min(1).max(32)).min(1).max(16) }).strict()
  .refine(value => value.assertionsPerTest.length === value.plan.expectedTests &&
    value.assertionsPerTest.reduce((sum, n) => sum+n, 0) === value.plan.expectedAssertions);
export type ReporterPlan = z.infer<typeof reportPlanSchema>;
const completionSchema = executionReceiptSchema.pick({ startedAtMs: true, finishedAtMs: true, exitCode: true,
  timedOut: true, setupFailure: true, stdoutSha256: true, stderrSha256: true, artifactManifestSha256: true });
export type ReporterCompletion = z.infer<typeof completionSchema>;
export type ReporterResult = { ok: true; value: Readonly<{ decoded: DecodedExecution; eventStreamSha256: string; authentic: false }> } |
  { ok: false; reason: "MALFORMED" | "LIMIT" | "ORDER" | "BINDING_MISMATCH" | "INCOMPLETE" | "CLOSED" | "INCONSISTENT" };
type Failure = Extract<ReporterResult, { ok: false }>["reason"];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Explicit event encoder, not a test runner, assertion counter or trust root. */
export function encodeReporterEvent(event: ReporterEvent): Buffer {
  return Buffer.from(JSON.stringify(eventSchema.parse(event))+"\n");
}
/** Caller must derive this plan from protected source/commands, not guest claims. */
export function reporterPlanSha256(input: ReporterPlan): string {
  return hash(Buffer.from(JSON.stringify(reportPlanSchema.parse(input))));
}

/** Bounded dedicated-channel protocol. Raw stdout/Node test:pass is insufficient. */
export class OwnedReporterCollector {
  #plan: ExecutionPlan;
  #assertions: readonly number[];
  #planSha256: string;
  #digest = createHash("sha256");
  #bytes = 0;
  #line = Buffer.alloc(0);
  #seq = 1;
  #started = false;
  #ended = false;
  #closed = false;
  #failure: Failure | undefined;
  #tests: ExecutionReceipt["tests"] = [];
  #active: { index: number; passed: number; failed: number } | undefined;
  constructor(input: ReporterPlan) {
    const checked = reportPlanSchema.parse(input);
    this.#plan = checked.plan; this.#assertions = checked.assertionsPerTest;
    this.#planSha256 = reporterPlanSha256(checked);
  }
  toJSON() { return { reporter: "rpf-reporter-v1", authentic: false }; }
  #reject(reason: Failure): false { this.#failure ??= reason; this.#line = Buffer.alloc(0); return false; }
  #event(bytes: Buffer): boolean {
    if (bytes.byteLength === 0 || bytes.byteLength > 1024) return this.#reject("LIMIT");
    let event: ReporterEvent;
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      event = eventSchema.parse(JSON.parse(text));
      if (!Buffer.concat([bytes,Buffer.from("\n")]).equals(encodeReporterEvent(event))) return this.#reject("MALFORMED");
    } catch { return this.#reject("MALFORMED"); }
    if (this.#ended || event.seq !== this.#seq++) return this.#reject("ORDER");
    if (!this.#started) {
      if (event.type !== "START") return this.#reject("ORDER");
      if (event.planSha256 !== this.#planSha256) return this.#reject("BINDING_MISMATCH");
      this.#started = true; return true;
    }
    if (event.type === "START") return this.#reject("ORDER");
    if (event.type === "END") {
      if (this.#active) return this.#reject("ORDER");
      this.#ended = true; return true;
    }
    if (event.type === "TEST_START") {
      if (this.#active || event.index !== this.#tests.length+1 || event.index > this.#plan.expectedTests) return this.#reject("ORDER");
      this.#active = { index: event.index, passed: 0, failed: 0 }; return true;
    }
    const active = this.#active;
    if (!active || event.index !== active.index) return this.#reject("ORDER");
    const expected = this.#assertions[active.index-1]!;
    if (event.type === "ASSERTION") {
      if (active.failed || event.assertion !== active.passed+1 || event.assertion > expected) return this.#reject("ORDER");
      if (event.outcome === "FAILED") active.failed++; else active.passed++;
      return true;
    }
    if (event.outcome === "PASSED" ? active.failed !== 0 || active.passed !== expected || event.failureKind !== null :
      event.outcome === "SKIPPED" ? active.passed !== 0 || active.failed !== 0 || event.failureKind !== null :
      event.failureKind === null || (event.failureKind === "ASSERTION" ? active.failed !== 1 : active.failed !== 0)) return this.#reject("INCONSISTENT");
    this.#tests.push({ index: active.index, outcome: event.outcome, assertionsPassed: active.passed,
      assertionsFailed: active.failed, failureKind: event.failureKind });
    this.#active = undefined; return true;
  }
  /** Synchronous bounded chunks; controller owns transport timeout/cancellation. */
  write(chunk: Uint8Array): boolean {
    if (this.#closed) return this.#reject("CLOSED");
    if (this.#failure) return false;
    if (!(chunk instanceof Uint8Array)) return this.#reject("MALFORMED");
    this.#bytes += chunk.byteLength;
    if (this.#bytes > 131072) return this.#reject("LIMIT");
    const copy = Buffer.from(chunk); this.#digest.update(copy);
    const pending = Buffer.concat([this.#line,copy]);
    let start = 0;
    for (;;) {
      const end = pending.indexOf(10,start); if (end === -1) break;
      if (!this.#event(pending.subarray(start,end))) return false;
      start = end+1;
    }
    this.#line = Buffer.from(pending.subarray(start));
    return this.#line.byteLength > 1024 ? this.#reject("LIMIT") : true;
  }
  finish(input: ReporterCompletion): ReporterResult {
    if (this.#closed) return { ok: false, reason: "CLOSED" };
    this.#closed = true;
    if (this.#failure) return { ok: false, reason: this.#failure };
    if (!this.#started || !this.#ended || this.#active || this.#line.byteLength) return { ok: false, reason: "INCOMPLETE" };
    let completion: ReporterCompletion;
    try { completion = completionSchema.parse(input); } catch { return { ok: false, reason: "MALFORMED" }; }
    const counts = { executed: 0, passed: 0, failed: 0, skipped: 0, assertionsPassed: 0, assertionsFailed: 0 };
    for (const test of this.#tests) {
      counts.assertionsPassed += test.assertionsPassed; counts.assertionsFailed += test.assertionsFailed;
      if (test.outcome === "SKIPPED") counts.skipped++;
      else { counts.executed++; if (test.outcome === "PASSED") counts.passed++; else counts.failed++; }
    }
    const receipt: ExecutionReceipt = { version: "rpf-result-v1", provenance: this.#plan.provenance, binding: this.#plan.binding,
      ...completion, tests: this.#tests, counts };
    const decoded = decodeExecutionReceipt(encodeExecutionReceipt(receipt), this.#plan);
    if (!decoded.ok) return decoded;
    return { ok: true, value: Object.freeze({ decoded: decoded.value, eventStreamSha256: this.#digest.digest("hex"), authentic: false }) };
  }
}
