import { z } from "zod";
import { assertionBlueprintSchema, assertionBlueprintSha256, assertionMarker, decodeAssertionEvent, type AssertionBlueprint, type AssertionEvent } from "./assertionCounter";
import { encodeReporterEvent, reporterPlanSha256, type ReporterEvent } from "./reporter";

type Failure = "NATIVE_EVENT" | "NATIVE_LIMIT" | "COUNTER_EVENT" | "COUNTER_MISMATCH" | "NATIVE_INCOMPLETE" | "CLOSED";
export type NodeReporterResult = { ok: false;reason: Failure } | { ok: true;bytes: Buffer;authentic: false };
const count = z.number().int().min(0).max(4096);
const envelope = z.object({ type: z.string().max(64),data: z.unknown() }).strict();
const dataObject = z.record(z.string(),z.unknown());
const summarySchema = z.object({ file: z.string().optional(),success: z.boolean(),counts: z.object({ tests: count,passed: count,failed: count,skipped: count,
  cancelled: count,todo: count,suites: count,topLevel: count }) });
const testSchema = z.object({ name: z.string().min(1).max(200),file: z.string().max(512),entryFile: z.string().max(512).optional(),nesting: z.literal(0),
  skip: z.union([z.boolean(),z.string().max(200)]).optional(),todo: z.union([z.boolean(),z.string().max(200)]).optional(),
  details: z.object({ type: z.enum(["test","suite"]).optional(),attempt: z.unknown().optional(),passed_on_attempt: z.unknown().optional(),error: z.unknown().optional() }) });
const ignored = new Set(["test:enqueue","test:dequeue","test:start","test:complete","test:plan"]);
type NativeResult = { outcome: "PASSED" | "FAILED" | "SKIPPED";assertionFailure: boolean };

/** Consumes trusted Node event objects; never parses stdout as a counter. */
export class OwnedNodeEventCollector {
  #blueprint: AssertionBlueprint;
  #blueprintHash: string;
  #planHash: string;
  #events = 0;
  #outputBytes = 0;
  #failure: Failure | undefined;
  #closed = false;
  #assertions = new Map<number,AssertionEvent[]>();
  #results = new Map<number,NativeResult>();
  #summaries: z.infer<typeof summarySchema>[] = [];
  constructor(input: AssertionBlueprint) {
    this.#blueprint = assertionBlueprintSchema.parse(input); this.#blueprintHash = assertionBlueprintSha256(this.#blueprint); this.#planHash = reporterPlanSha256(this.#blueprint.reporter);
  }
  #reject(reason: Failure): false { this.#failure ??= reason; return false; }
  write(input: unknown): boolean {
    if (this.#closed) return this.#reject("CLOSED"); if (this.#failure) return false;
    if (++this.#events > 4096) return this.#reject("NATIVE_LIMIT");
    try {
      const event = envelope.parse(input), data = dataObject.parse(event.data);
      if (ignored.has(event.type)) return true;
      if (event.type === "test:stdout" || event.type === "test:stderr") {
        if (typeof data.message !== "string") return this.#reject("NATIVE_EVENT");
        this.#outputBytes += Buffer.byteLength(data.message); return this.#outputBytes > 16384 ? this.#reject("NATIVE_LIMIT") : true;
      }
      if (event.type === "test:diagnostic") {
        if (typeof data.message !== "string" || Buffer.byteLength(data.message) > 4096) return this.#reject("NATIVE_LIMIT");
        if (!data.message.startsWith(assertionMarker)) return true;
        if (data.file !== this.#blueprint.expectedFile || data.nesting !== 0) return this.#reject("COUNTER_EVENT");
        let assertion: AssertionEvent;
        try { assertion = decodeAssertionEvent(data.message.slice(assertionMarker.length)); } catch { return this.#reject("COUNTER_EVENT"); }
        const test = this.#blueprint.tests[assertion.index-1], previous = this.#assertions.get(assertion.index) ?? [];
        if (!test || assertion.blueprintSha256 !== this.#blueprintHash || assertion.planSha256 !== this.#planHash || assertion.assertion !== previous.length+1 ||
          assertion.assertion > test.assertions || previous.some(a => a.outcome === "FAILED")) return this.#reject("COUNTER_EVENT");
        previous.push(assertion); this.#assertions.set(assertion.index,previous); return true;
      }
      if (event.type === "test:pass" || event.type === "test:fail") {
        const test = testSchema.parse(data), expected = this.#blueprint.tests.find(t => t.name === test.name);
        if (!expected || test.file !== this.#blueprint.expectedFile || (test.entryFile !== undefined && test.entryFile !== this.#blueprint.expectedFile) ||
          test.details.type === "suite" || test.details.attempt !== undefined || test.details.passed_on_attempt !== undefined || this.#results.has(expected.index)) return this.#reject("NATIVE_EVENT");
        const error = test.details.error, cause = error && typeof error === "object" ? Reflect.get(error,"cause") : null;
        const assertionFailure = !!cause && typeof cause === "object" && Reflect.get(cause,"code") === "ERR_ASSERTION";
        const skipped = test.skip === true || typeof test.skip === "string" || test.todo === true || typeof test.todo === "string";
        this.#results.set(expected.index,{ outcome: skipped ? "SKIPPED" : event.type === "test:pass" ? "PASSED" : "FAILED",assertionFailure }); return true;
      }
      if (event.type === "test:summary") {
        const summary = summarySchema.parse(data);
        if ((summary.file !== undefined && summary.file !== this.#blueprint.expectedFile) || this.#summaries.length >= 2) return this.#reject("NATIVE_EVENT");
        this.#summaries.push(summary); return true;
      }
      return this.#reject("NATIVE_EVENT");
    } catch { return this.#reject("NATIVE_EVENT"); }
  }
  finish(): NodeReporterResult {
    if (this.#closed) return { ok: false,reason: "CLOSED" }; this.#closed = true;
    if (this.#failure) return { ok: false,reason: this.#failure };
    if (!this.#summaries.some(s => s.file === undefined)) return { ok: false,reason: "NATIVE_INCOMPLETE" };
    const records = [...this.#results].sort(([a],[b]) => a-b), totals = { tests: records.length,passed: 0,failed: 0,skipped: 0 };
    for (const [,r] of records) { if (r.outcome === "PASSED") totals.passed++; else if (r.outcome === "FAILED") totals.failed++; else totals.skipped++; }
    if (this.#summaries.some(s => s.counts.tests !== totals.tests || s.counts.passed !== totals.passed || s.counts.failed !== totals.failed || s.counts.skipped !== totals.skipped ||
      s.counts.suites !== 0 || s.counts.todo !== 0 || s.counts.cancelled !== 0 || s.counts.topLevel !== records.length || s.success !== (totals.failed === 0))) return { ok: false,reason: "NATIVE_INCOMPLETE" };
    const events: ReporterEvent[] = [{ type: "START",seq: 1,planSha256: this.#planHash }];
    for (const [i,[index,r]] of records.entries()) {
      const assertions = this.#assertions.get(index) ?? [], expected = this.#blueprint.tests[index-1]!;
      if (index !== i+1) return { ok: false,reason: "NATIVE_INCOMPLETE" };
      const failed = assertions.filter(a => a.outcome === "FAILED").length;
      if (r.outcome === "PASSED" ? failed !== 0 || assertions.length !== expected.assertions : r.outcome === "SKIPPED" ? assertions.length !== 0 : failed > 0 && !r.assertionFailure) return { ok: false,reason: "COUNTER_MISMATCH" };
      events.push({ type: "TEST_START",seq: 0,index });
      for (const a of assertions) events.push({ type: "ASSERTION",seq: 0,index,assertion: a.assertion,outcome: a.outcome });
      events.push({ type: "TEST_END",seq: 0,index,outcome: r.outcome,failureKind: r.outcome !== "FAILED" ? null : failed === 1 && r.assertionFailure ? "ASSERTION" : "UNKNOWN" });
    }
    if ([...this.#assertions.keys()].some(index => !this.#results.has(index))) return { ok: false,reason: "NATIVE_INCOMPLETE" };
    events.push({ type: "END",seq: 0 });
    const bytes = Buffer.concat(events.map((event,i) => encodeReporterEvent({ ...event,seq: i+1 })));
    if (bytes.length > 131072) return { ok: false,reason: "NATIVE_LIMIT" };
    return { ok: true,bytes,authentic: false };
  }
  toJSON() { return { reporter: "owned-node-events-v1",authentic: false }; }
}
/** Custom-reporter factory for a future protected image entrypoint; no runner. */
export function createOwnedNodeReporter(blueprint: AssertionBlueprint) {
  const checked = assertionBlueprintSchema.parse(blueprint);
  return async function* (source: AsyncIterable<unknown>): AsyncGenerator<Buffer> {
    const collector = new OwnedNodeEventCollector(checked);
    for await (const event of source) if (!collector.write(event)) throw new Error("OWNED_NODE_REPORTER_UNAVAILABLE");
    const result = collector.finish(); if (!result.ok) throw new Error("OWNED_NODE_REPORTER_UNAVAILABLE"); yield result.bytes;
  };
}
