import assert, { AssertionError } from "node:assert/strict";
import * as nodeTest from "node:test";
import { isAbsolute } from "node:path";
import { parse } from "@babel/parser";
import type * as t from "@babel/types";
import { z } from "zod";
import { fixturePin } from "../sandbox/fixture";
import { admitDiscount } from "./admissibility";
import { readSnapshot, sha256, type PreparedSnapshot } from "./frozen";
import { reportPlanSchema, reporterPlanSha256, type ReporterPlan } from "./reporter";

export const assertionMarker = "RPF_ASSERT_V1 ";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const assertionBlueprintSchema = z.object({ version: z.literal("rpf-assertion-blueprint-v1"),
  expectedFile: z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f]+$/).refine(isAbsolute),reporter: reportPlanSchema,
  tests: z.array(z.object({ index: z.number().int().min(1).max(16),name: z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/),
    assertions: z.number().int().min(1).max(32) }).strict()).min(1).max(16) }).strict()
  .refine(v => v.tests.length === v.reporter.plan.expectedTests && new Set(v.tests.map(test => test.name)).size === v.tests.length &&
    v.tests.every((test,i) => test.index === i+1 && test.assertions === v.reporter.assertionsPerTest[i]));
export type AssertionBlueprint = z.infer<typeof assertionBlueprintSchema>;
export const assertionEventSchema = z.object({ version: z.literal("rpf-assertion-v1"),blueprintSha256: digest,planSha256: digest,
  index: z.number().int().min(1).max(16),assertion: z.number().int().min(1).max(32),outcome: z.enum(["PASSED","FAILED"]) }).strict();
export type AssertionEvent = z.infer<typeof assertionEventSchema>;
export function assertionBlueprintSha256(input: AssertionBlueprint): string { return sha256(Buffer.from(JSON.stringify(assertionBlueprintSchema.parse(input)))); }
export function encodeAssertionEvent(input: AssertionEvent): string { return JSON.stringify(assertionEventSchema.parse(input)); }
export function decodeAssertionEvent(text: string): AssertionEvent {
  if (Buffer.byteLength(text) > 1024) throw new Error("ASSERTION_EVENT_INVALID");
  try { const event = assertionEventSchema.parse(JSON.parse(text)); if (text !== encodeAssertionEvent(event)) throw new Error(); return event; }
  catch { throw new Error("ASSERTION_EVENT_INVALID"); }
}

/** Static names/counts from private snapshot bytes, without evaluating tests. */
export function deriveAssertionBlueprint(snapshot: PreparedSnapshot, instanceId: string, reporter: ReporterPlan): AssertionBlueprint {
  z.string().uuid().regex(/^[a-f0-9-]+$/).parse(instanceId);
  const plan = reportPlanSchema.parse(reporter), path = plan.plan.binding.suite === "ISSUE" ? "tests/issue.generated.mjs" : "tests/regression.mjs";
  const file = readSnapshot(snapshot).find(file => file.path === path)!;
  const admitted = admitDiscount(file.content,path === "tests/regression.mjs" ? "regressions" : "issue");
  if (admitted.status !== "ADMISSIBLE" || plan.plan.binding.baseSha !== fixturePin || plan.plan.binding.stage !== snapshot.stage ||
    plan.plan.binding.snapshotSha256 !== snapshot.snapshotSha256 || plan.plan.binding.frozenManifestSha256 !== snapshot.frozenManifestSha256 ||
    plan.plan.binding.testSha256 !== admitted.sha256 || plan.plan.expectedTests !== admitted.tests || plan.plan.expectedAssertions !== admitted.assertions) throw new Error("ASSERTION_BLUEPRINT_MISMATCH");
  const program = parse(file.content.toString("utf8"),{ sourceType: "module",strictMode: true,errorRecovery: false,annexB: false,attachComment: false }).program;
  const tests = program.body.filter((s): s is t.ExpressionStatement => s.type === "ExpressionStatement").map((s,i) => {
    // The complete grammar was already checked; these assertions cannot admit
    // additional syntax or invoke a callback.
    const call = s.expression as t.CallExpression, title = call.arguments[0] as t.StringLiteral, body = (call.arguments[1] as t.ArrowFunctionExpression).body as t.BlockStatement;
    return { index: i+1,name: title.value,assertions: body.body.filter(statement => statement.type === "ExpressionStatement").length };
  });
  return assertionBlueprintSchema.parse({ version: "rpf-assertion-blueprint-v1",expectedFile: `/vercel/sandbox/rpf-prepared-${instanceId}/${path}`,reporter: plan,tests });
}
export type AssertionContext = { name: string;filePath: string;fullName: string;diagnostic?: (message: string) => void };
const nativeEqual = assert.equal, nativeStrictEqual = assert.strictEqual;
export class AssertionCounterError extends Error { constructor() { super("ASSERTION_COUNTER_UNAVAILABLE"); } }
/** Hooks are trusted counter wiring, not caller-supplied source or an executor. */
export function createAssertionCounter(input: AssertionBlueprint, context: () => AssertionContext | undefined,
  emit: (event: AssertionEvent, context: AssertionContext) => void) {
  const blueprint = assertionBlueprintSchema.parse(input), blueprintSha256 = assertionBlueprintSha256(blueprint), planSha256 = reporterPlanSha256(blueprint.reporter);
  const states = new Map<string,{ seen: number;failed: boolean;context: AssertionContext }>(); let poisoned = false;
  const unavailable = (): never => { poisoned = true; throw new AssertionCounterError(); };
  const wrap = (original: typeof nativeEqual) => (...args: unknown[]) => {
    if (poisoned || args.length !== 2) unavailable();
    let ctx: AssertionContext | undefined;
    try { ctx = context(); } catch { unavailable(); }
    const test = blueprint.tests.find(test => test.name === ctx?.name);
    if (!ctx || !test || ctx.filePath !== blueprint.expectedFile || ctx.fullName !== ctx.name) unavailable();
    const previous = states.get(test!.name);
    if ((previous && previous.context !== ctx) || previous?.failed || (previous?.seen ?? 0) >= test!.assertions) unavailable();
    const state = previous ?? { seen: 0,failed: false,context: ctx! }; states.set(test!.name,state);
    let failed: AssertionError | undefined;
    try { original(args[0],args[1]); }
    catch (error) { if (!(error instanceof AssertionError) || error.code !== "ERR_ASSERTION") unavailable(); failed = error as AssertionError; }
    const event: AssertionEvent = { version: "rpf-assertion-v1",blueprintSha256,planSha256,index: test!.index,assertion: state.seen+1,outcome: failed ? "FAILED" : "PASSED" };
    try { emit(event,ctx!); } catch { unavailable(); }
    state.seen++; state.failed = !!failed;
    if (failed) throw failed; // Preserve the original native error and identity.
  };
  return Object.freeze({ equal: wrap(nativeEqual),strictEqual: wrap(nativeStrictEqual),authentic: false as const });
}
let installed = false;
/** One-shot process-local preload. Does not run tests or read source/config files. */
export function installNodeAssertionCounter(input: AssertionBlueprint): void {
  const getContext: unknown = Reflect.get(nodeTest,"getTestContext");
  if (process.version !== "v24.22.2" || installed || typeof getContext !== "function" || assert.equal !== nativeEqual || assert.strictEqual !== nativeStrictEqual) throw new AssertionCounterError();
  for (const name of ["equal","strictEqual"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(assert,name);
    if (!descriptor || !descriptor.writable || !descriptor.configurable || !("value" in descriptor)) throw new AssertionCounterError();
  }
  const counter = createAssertionCounter(input,() => getContext() as AssertionContext | undefined,(event,ctx) => {
    if (typeof ctx.diagnostic !== "function") throw new AssertionCounterError(); ctx.diagnostic(assertionMarker+encodeAssertionEvent(event));
  });
  // Install only before loading the admitted test/source in a fresh process.
  Object.defineProperty(assert,"equal",{ value: counter.equal,writable: false,configurable: false });
  Object.defineProperty(assert,"strictEqual",{ value: counter.strictEqual,writable: false,configurable: false }); installed = true;
}
