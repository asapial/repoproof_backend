import { describe, expect, it } from "vitest";
import { approvalHeadersSchema, createRunRequestSchema, createRunResponseSchema, errorResponseSchema, eventsQuerySchema, eventsResponseSchema, reportResponseSchema, runResponseSchema } from "./v1";

const sha = "a".repeat(40);
const execution = { outcome: "PASSED", executed: 1, passed: 1, skipped: 0, exitCode: 0 };
const report = {
  runId: "run_1", state: "COMPLETED", verdict: "NO_REPRO", reasonCode: "BASELINE_PASSED",
  scopeStatement: "Frozen test only", policyVersion: "v1",
  issue: { number: 12, title: "Issue", url: "https://github.com/example/repo/issues/12" },
  provenance: { baseSha: sha, modelId: "model", reproducerOrigin: "CURATED", reproducerSha256: "a".repeat(64), runnerImageDigest: `sha256:${"b".repeat(64)}` },
  evidence: { baselineRegressions: execution, baselineIssueTest: execution, patchedIssueTest: null, regressions: null, integrity: { sameTestBytes: true, sameRunnerImage: true, policyClean: true } },
  patch: null, limitations: ["Fixture only"],
};
const event = { seq: 6, stage: "BASELINING", type: "TEST", title: "Test", detail: { executed: 1 }, at: "2026-10-31T08:10:00Z" };

describe("v1 request and response contracts", () => {
  it("validates run creation and rejects invalid identifiers, numbers and extra input", () => {
    const input = { repositoryId: "repo_fixture_01", issueNumber: 12, fixtureKey: "discount-bug" };
    expect(createRunRequestSchema.parse(input)).toEqual(input);
    for (const invalid of [{ ...input, issueNumber: 0 }, { ...input, issueNumber: 1.5 }, { ...input, repositoryId: "../repo" }, { ...input, fixtureKey: " " }, { ...input, extra: true }]) expect(createRunRequestSchema.safeParse(invalid).success).toBe(false);
    expect(createRunResponseSchema.safeParse({ id: "run_1", state: "ANALYZING", baseSha: sha, repository: "owner/repo", issueNumber: 12, links: { self: "/api/v1/runs/run_1" } }).success).toBe(true);
    expect(createRunResponseSchema.safeParse({ id: "run_1", state: "DONE", baseSha: sha, repository: "owner/repo", issueNumber: 12, links: { self: "https://example.com" } }).success).toBe(false);
  });
  it("requires pending approval and a plan for an approval state", () => {
    const run = { id: "run_1", state: "AWAITING_APPROVAL", baseSha: sha, plan: { summary: "s", suspectedFiles: [], testHypothesis: "t", preconditions: [], riskFlags: [] }, approval: "PENDING", reportUrl: null };
    expect(runResponseSchema.safeParse(run).success).toBe(true);
    expect(runResponseSchema.safeParse({ ...run, plan: null }).success).toBe(false);
    expect(runResponseSchema.safeParse({ ...run, approval: "APPROVED" }).success).toBe(false);
    expect(runResponseSchema.safeParse({ ...run, reportUrl: "/api/v1/runs/run_1/report" }).success).toBe(false);
    expect(approvalHeadersSchema.safeParse({ "idempotency-key": "not-uuid" }).success).toBe(false);
    expect(approvalHeadersSchema.safeParse({ "idempotency-key": "11111111-1111-1111-1111-111111111111" }).success).toBe(true);
    expect(approvalHeadersSchema.safeParse({ "idempotency-key": "d65f1715-6634-4507-9039-a09cc983cb81" }).success).toBe(true);
  });
  it("checks cursor syntax, event order and matching next cursor", () => {
    expect(eventsQuerySchema.parse({ afterSeq: "5" })).toEqual({ afterSeq: 5 });
    for (const afterSeq of ["-1", "1.5", "01", "9007199254740992"]) expect(eventsQuerySchema.safeParse({ afterSeq }).success).toBe(false);
    const page = { runId: "run_1", events: [event], nextCursor: 6, terminal: false };
    expect(eventsResponseSchema.safeParse(page).success).toBe(true);
    expect(eventsResponseSchema.safeParse({ ...page, events: [{ ...event, detail: { nested: [{ ok: true, value: null }] } }] }).success).toBe(true);
    expect(eventsResponseSchema.safeParse({ ...page, events: [{ ...event, detail: { invalid: Infinity } }] }).success).toBe(false);
    expect(eventsResponseSchema.safeParse({ ...page, nextCursor: 5 }).success).toBe(false);
    expect(eventsResponseSchema.safeParse({ ...page, events: [event, event] }).success).toBe(false);
    expect(eventsResponseSchema.safeParse({ ...page, events: [{ ...event, seq: 0 }] }).success).toBe(false);
  });
  it("requires the documented error envelope and rejects extra fields", () => {
    expect(errorResponseSchema.safeParse({ error: { code: "INVALID_INPUT", message: "Invalid input", requestId: "req_1" } }).success).toBe(true);
    expect(errorResponseSchema.safeParse({ error: { code: "invalid", message: "", requestId: "req_1", stack: "secret" } }).success).toBe(false);
    expect(errorResponseSchema.safeParse({ success: false, message: "failed" }).success).toBe(false);
  });
  it("requires honest no-patch evidence and valid counts", () => {
    expect(reportResponseSchema.safeParse(report).success).toBe(true);
    expect(reportResponseSchema.safeParse({ ...report, patch: { attemptNumber: 1, changedFiles: 1, diffArtifactId: "art_1" } }).success).toBe(false);
    expect(reportResponseSchema.safeParse({ ...report, evidence: { ...report.evidence, patchedIssueTest: execution } }).success).toBe(false);
    expect(reportResponseSchema.safeParse({ ...report, evidence: { ...report.evidence, baselineIssueTest: { ...execution, passed: 2 } } }).success).toBe(false);
    expect(reportResponseSchema.safeParse({ ...report, provenance: { ...report.provenance, reproducerSha256: "bad" } }).success).toBe(false);
  });
});
