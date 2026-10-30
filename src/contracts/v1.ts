import { z } from "zod";
import { baseShaSchema, reproducerOriginSchema, runStateSchema, sha256Schema, testOutcomeSchema, verificationVerdictSchema } from "./repoproof";

// Proposed wire contracts for future /api/v1 routes; no routes are registered here.
export const API_V1_BASE = "/api/v1" as const;
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().trim().min(1);
const count = z.number().int().nonnegative().safe();
const positiveInt = z.number().int().positive().safe();
const relativeApiUrl = z.string().regex(/^\/api\/v1\/(?!\/)[A-Za-z0-9_/?=&.%-]+$/);
export const approvalDecisionSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export const createRunRequestSchema = z.object({ repositoryId: id, issueNumber: positiveInt, fixtureKey: id }).strict();
export const createRunResponseSchema = z.object({
  id, state: runStateSchema, baseSha: baseShaSchema, repository: text,
  issueNumber: positiveInt, links: z.object({ self: relativeApiUrl }).strict(),
}).strict();
export const runPlanSchema = z.object({
  summary: text, suspectedFiles: z.array(text), testHypothesis: text,
  preconditions: z.array(text), riskFlags: z.array(text),
}).strict();
export const runResponseSchema = z.object({
  id, state: runStateSchema, baseSha: baseShaSchema, plan: runPlanSchema.nullable(),
  approval: approvalDecisionSchema, reportUrl: relativeApiUrl.nullable(),
}).strict().superRefine((run, ctx) => {
  if (run.state === "AWAITING_APPROVAL" && (run.plan === null || run.approval !== "PENDING")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Awaiting approval requires a plan and pending approval" });
  }
  if (run.reportUrl !== null && run.state !== "COMPLETED") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A report URL requires a completed run" });
  }
});
export const approvalHeadersSchema = z.object({ "idempotency-key": z.guid() }).passthrough();
export const runIdParamsSchema = z.object({ id }).strict();
export const artifactParamsSchema = z.object({ id, artifactId: id }).strict();
export const eventsQuerySchema = z.object({ afterSeq: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(count).optional() }).strict();
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]));
export const runEventSchema = z.object({
  seq: positiveInt, stage: runStateSchema, type: text, title: text,
  detail: z.record(z.string(), jsonValueSchema), at: z.string().datetime({ offset: true }),
}).strict();
export const eventsResponseSchema = z.object({
  runId: id, events: z.array(runEventSchema), nextCursor: count.nullable(), terminal: z.boolean(),
}).strict().superRefine((page, ctx) => {
  for (let i = 1; i < page.events.length; i++) {
    if (page.events[i]!.seq <= page.events[i - 1]!.seq) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Event sequences must increase" });
  }
  const last = page.events.at(-1);
  if (last && page.nextCursor !== last.seq) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Cursor must equal last event sequence" });
});
export const errorResponseSchema = z.object({ error: z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/), message: text, requestId: id,
}).strict() }).strict();
const executionSchema = z.object({
  outcome: testOutcomeSchema, executed: count, passed: count.optional(), failed: count.optional(),
  skipped: count, exitCode: z.number().int().nullable(), failureKind: text.optional(),
}).strict().superRefine((result, ctx) => {
  if ((result.passed ?? 0) + (result.failed ?? 0) > result.executed) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Test counts exceed executed tests" });
});
export const reportResponseSchema = z.object({
  runId: id, state: z.literal("COMPLETED"), verdict: verificationVerdictSchema,
  reasonCode: text, scopeStatement: text, policyVersion: text,
  issue: z.object({ number: positiveInt, title: text, url: z.string().url() }).strict(),
  provenance: z.object({ baseSha: baseShaSchema, modelId: text, reproducerOrigin: reproducerOriginSchema,
    reproducerSha256: sha256Schema, runnerImageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
  evidence: z.object({ baselineRegressions: executionSchema, baselineIssueTest: executionSchema,
    patchedIssueTest: executionSchema.nullable(), regressions: executionSchema.nullable(),
    integrity: z.object({ sameTestBytes: z.boolean(), sameRunnerImage: z.boolean(), policyClean: z.boolean() }).strict(),
  }).strict(),
  patch: z.object({ attemptNumber: z.number().int().min(1).max(2), changedFiles: positiveInt, diffArtifactId: id }).strict().nullable(),
  limitations: z.array(text),
}).strict().superRefine((report, ctx) => {
  if (report.patch === null && (report.evidence.patchedIssueTest !== null || report.evidence.regressions !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Patched evidence requires a patch" });
  }
  if (report.verdict === "NO_REPRO" && report.patch !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "NO_REPRO cannot include a patch" });
  }
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
export type RunPlan = z.infer<typeof runPlanSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type ApprovalHeaders = z.infer<typeof approvalHeadersSchema>;
export type RunIdParams = z.infer<typeof runIdParamsSchema>;
export type ArtifactParams = z.infer<typeof artifactParamsSchema>;
export type EventsQuery = z.infer<typeof eventsQuerySchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type EventsResponse = z.infer<typeof eventsResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
