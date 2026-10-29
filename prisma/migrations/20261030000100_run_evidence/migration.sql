-- CreateEnum
CREATE TYPE "RunState" AS ENUM ('CREATED', 'ANALYZING', 'AWAITING_APPROVAL', 'QUEUED', 'PREPARING', 'GENERATING_REPRO', 'BASELINING', 'PATCHING', 'VERIFYING', 'REPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationVerdict" AS ENUM ('VERIFIED', 'REJECTED', 'NO_REPRO', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "ReproducerOrigin" AS ENUM ('MODEL_GENERATED', 'CURATED');

-- CreateEnum
CREATE TYPE "TestPhase" AS ENUM ('BASELINE_REPRO', 'BASELINE_REGRESSION', 'PATCHED_REPRO', 'PATCHED_REGRESSION');

-- CreateEnum
CREATE TYPE "TestOutcome" AS ENUM ('PASSED', 'FAILED', 'ERROR', 'TIMEOUT', 'SKIPPED', 'NO_TESTS');

-- CreateEnum
CREATE TYPE "PatchCheckStatus" AS ENUM ('PROPOSED', 'ALLOWED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('ISSUE_CONTEXT', 'FROZEN_TEST', 'TEST_MANIFEST', 'BASELINE_STDOUT', 'BASELINE_STDERR', 'PATCHED_STDOUT', 'PATCHED_STDERR', 'PATCH_DIFF', 'RUNNER_MANIFEST', 'REPORT_JSON', 'REPORT_MARKDOWN');

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "githubRepoId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "fixtureKey" TEXT,
    "mvpAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueSnapshot" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "issueUrl" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "repositoryId" TEXT NOT NULL,
    "issueSnapshotId" TEXT NOT NULL,
    "baseSha" VARCHAR(40) NOT NULL,
    "fixtureKey" TEXT NOT NULL,
    "requestKeyHash" TEXT,
    "state" "RunState" NOT NULL DEFAULT 'CREATED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "planJson" JSONB,
    "failCode" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "modelId" TEXT,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunApproval" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "actorId" TEXT,
    "idempotencyKeyHash" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReproductionTest" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "origin" "ReproducerOrigin" NOT NULL,
    "testId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "runnerImageDigest" TEXT NOT NULL,
    "commandManifestSha256" VARCHAR(64) NOT NULL,
    "validAssertion" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReproductionTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatchAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "checkStatus" "PatchCheckStatus" NOT NULL DEFAULT 'PROPOSED',
    "failureCode" TEXT,
    "patchSha256" VARCHAR(64),
    "diffArtifactKey" TEXT,
    "changedFiles" INTEGER NOT NULL DEFAULT 0,
    "changedLines" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PatchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptId" TEXT,
    "phase" "TestPhase" NOT NULL,
    "outcome" "TestOutcome" NOT NULL,
    "testId" TEXT,
    "testSha256" VARCHAR(64),
    "runnerImageDigest" TEXT NOT NULL,
    "commandManifestSha256" VARCHAR(64) NOT NULL,
    "collected" INTEGER NOT NULL DEFAULT 0,
    "executed" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "exitCode" INTEGER,
    "failureKind" TEXT,
    "stdoutArtifactKey" TEXT,
    "stderrArtifactKey" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "mediaType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" BIGSERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stage" "RunState" NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationReport" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "verdict" "VerificationVerdict" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "scopeStatement" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "limitationsJson" JSONB NOT NULL,
    "reportSha256" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepoId_key" ON "Repository"("githubRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fixtureKey_key" ON "Repository"("fixtureKey");

-- CreateIndex
CREATE INDEX "Repository_mvpAllowed_idx" ON "Repository"("mvpAllowed");

-- CreateIndex
CREATE INDEX "IssueSnapshot_repositoryId_number_capturedAt_idx" ON "IssueSnapshot"("repositoryId", "number", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Run_requestKeyHash_key" ON "Run"("requestKeyHash");

-- CreateIndex
CREATE INDEX "Run_state_leaseExpiresAt_idx" ON "Run"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Run_repositoryId_createdAt_idx" ON "Run"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_userId_createdAt_idx" ON "Run"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunApproval_runId_key" ON "RunApproval"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "RunApproval_idempotencyKeyHash_key" ON "RunApproval"("idempotencyKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ReproductionTest_runId_key" ON "ReproductionTest"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ReproductionTest_storageKey_key" ON "ReproductionTest"("storageKey");

-- CreateIndex
CREATE INDEX "PatchAttempt_runId_createdAt_idx" ON "PatchAttempt"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatchAttempt_runId_attemptNumber_key" ON "PatchAttempt"("runId", "attemptNumber");

-- CreateIndex
CREATE INDEX "TestExecution_runId_phase_createdAt_idx" ON "TestExecution"("runId", "phase", "createdAt");

-- CreateIndex
CREATE INDEX "TestExecution_attemptId_phase_idx" ON "TestExecution"("attemptId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_storageKey_key" ON "Artifact"("storageKey");

-- CreateIndex
CREATE INDEX "Artifact_runId_kind_idx" ON "Artifact"("runId", "kind");

-- CreateIndex
CREATE INDEX "Artifact_expiresAt_idx" ON "Artifact"("expiresAt");

-- CreateIndex
CREATE INDEX "RunEvent_runId_createdAt_idx" ON "RunEvent"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunEvent_runId_seq_key" ON "RunEvent"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationReport_runId_key" ON "VerificationReport"("runId");

-- AddForeignKey
ALTER TABLE "IssueSnapshot" ADD CONSTRAINT "IssueSnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_issueSnapshotId_fkey" FOREIGN KEY ("issueSnapshotId") REFERENCES "IssueSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunApproval" ADD CONSTRAINT "RunApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReproductionTest" ADD CONSTRAINT "ReproductionTest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatchAttempt" ADD CONSTRAINT "PatchAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestExecution" ADD CONSTRAINT "TestExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestExecution" ADD CONSTRAINT "TestExecution_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PatchAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Evidence integrity is enforced for ordinary database roles. Administrative
-- owners can still alter database policy; retention requires a separate design.
ALTER TABLE "IssueSnapshot" ADD CONSTRAINT "IssueSnapshot_number_positive" CHECK ("number" > 0);
ALTER TABLE "Run" ADD CONSTRAINT "Run_baseSha_valid" CHECK ("baseSha" ~ '^[0-9a-f]{40}$');
ALTER TABLE "Run" ADD CONSTRAINT "Run_counts_nonnegative" CHECK ("version" >= 0 AND "modelCalls" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0);
ALTER TABLE "ReproductionTest" ADD CONSTRAINT "ReproductionTest_hashes_valid" CHECK ("sha256" ~ '^[0-9a-f]{64}$' AND "commandManifestSha256" ~ '^[0-9a-f]{64}$' AND "runnerImageDigest" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "PatchAttempt" ADD CONSTRAINT "PatchAttempt_bounds" CHECK ("attemptNumber" BETWEEN 1 AND 2 AND "changedFiles" >= 0 AND "changedLines" >= 0 AND ("patchSha256" IS NULL OR "patchSha256" ~ '^[0-9a-f]{64}$'));
ALTER TABLE "TestExecution" ADD CONSTRAINT "TestExecution_valid" CHECK ("collected" >= 0 AND "executed" >= 0 AND "passed" >= 0 AND "failed" >= 0 AND "skipped" >= 0 AND "durationMs" >= 0 AND "executed" = "passed" + "failed" AND "collected" >= "executed" + "skipped" AND ("testSha256" IS NULL OR "testSha256" ~ '^[0-9a-f]{64}$') AND "commandManifestSha256" ~ '^[0-9a-f]{64}$' AND "runnerImageDigest" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_valid" CHECK ("byteSize" >= 0 AND "sha256" ~ '^[0-9a-f]{64}$' AND length("storageKey") > 0);
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_seq_positive" CHECK ("seq" > 0);
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_hash_valid" CHECK ("reportSha256" ~ '^[0-9a-f]{64}$');

-- Bind each run to an issue from its own repository and each execution to an
-- attempt from the same run, including when callers bypass application code.
ALTER TABLE "IssueSnapshot" ADD CONSTRAINT "IssueSnapshot_id_repository_unique" UNIQUE ("id", "repositoryId");
ALTER TABLE "Run" ADD CONSTRAINT "Run_issue_repository_fkey" FOREIGN KEY ("issueSnapshotId", "repositoryId") REFERENCES "IssueSnapshot"("id", "repositoryId") ON DELETE RESTRICT;
ALTER TABLE "PatchAttempt" ADD CONSTRAINT "PatchAttempt_id_run_unique" UNIQUE ("id", "runId");
ALTER TABLE "TestExecution" ADD CONSTRAINT "TestExecution_attempt_run_fkey" FOREIGN KEY ("attemptId", "runId") REFERENCES "PatchAttempt"("id", "runId") ON DELETE RESTRICT;

CREATE FUNCTION repoproof_reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable evidence cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER issue_snapshot_immutable BEFORE UPDATE OR DELETE ON "IssueSnapshot" FOR EACH ROW EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER reproducer_immutable BEFORE UPDATE OR DELETE ON "ReproductionTest" FOR EACH ROW EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER test_execution_immutable BEFORE UPDATE OR DELETE ON "TestExecution" FOR EACH ROW EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER artifact_immutable BEFORE UPDATE OR DELETE ON "Artifact" FOR EACH ROW EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER run_event_immutable BEFORE UPDATE OR DELETE ON "RunEvent" FOR EACH ROW EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER verification_report_immutable BEFORE UPDATE OR DELETE ON "VerificationReport" FOR EACH ROW EXECUTE FUNCTION repoproof_reject_evidence_mutation();

CREATE FUNCTION repoproof_protect_run_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."userId", NEW."repositoryId", NEW."issueSnapshotId", NEW."baseSha", NEW."fixtureKey") IS DISTINCT FROM (OLD."id", OLD."userId", OLD."repositoryId", OLD."issueSnapshotId", OLD."baseSha", OLD."fixtureKey") THEN
    RAISE EXCEPTION 'run provenance cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER run_provenance_immutable BEFORE UPDATE ON "Run" FOR EACH ROW EXECUTE FUNCTION repoproof_protect_run_identity();

-- Row triggers do not fire on TRUNCATE. Treat bulk deletion as evidence mutation.
CREATE TRIGGER issue_snapshot_no_truncate BEFORE TRUNCATE ON "IssueSnapshot" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER reproducer_no_truncate BEFORE TRUNCATE ON "ReproductionTest" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER test_execution_no_truncate BEFORE TRUNCATE ON "TestExecution" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER artifact_no_truncate BEFORE TRUNCATE ON "Artifact" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER run_event_no_truncate BEFORE TRUNCATE ON "RunEvent" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();
CREATE TRIGGER verification_report_no_truncate BEFORE TRUNCATE ON "VerificationReport" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();

ALTER TABLE "RunApproval" ADD CONSTRAINT "RunApproval_decision_time_valid" CHECK (("decision" = 'PENDING' AND "decidedAt" IS NULL) OR ("decision" <> 'PENDING' AND "decidedAt" IS NOT NULL));
CREATE FUNCTION repoproof_protect_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD."decision" <> 'PENDING' OR OLD."decidedAt" IS NOT NULL OR (NEW."id", NEW."runId", NEW."createdAt") IS DISTINCT FROM (OLD."id", OLD."runId", OLD."createdAt") THEN
    RAISE EXCEPTION 'finalized approval or its identity cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER run_approval_protected BEFORE UPDATE OR DELETE ON "RunApproval" FOR EACH ROW EXECUTE FUNCTION repoproof_protect_approval();
CREATE TRIGGER run_approval_no_truncate BEFORE TRUNCATE ON "RunApproval" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();

CREATE FUNCTION repoproof_protect_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'patch attempt cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD."completedAt" IS NOT NULL OR (NEW."id", NEW."runId", NEW."attemptNumber", NEW."createdAt") IS DISTINCT FROM (OLD."id", OLD."runId", OLD."attemptNumber", OLD."createdAt") THEN
    RAISE EXCEPTION 'completed attempt or its identity cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patch_attempt_protected BEFORE UPDATE OR DELETE ON "PatchAttempt" FOR EACH ROW EXECUTE FUNCTION repoproof_protect_attempt();
CREATE TRIGGER patch_attempt_no_truncate BEFORE TRUNCATE ON "PatchAttempt" FOR EACH STATEMENT EXECUTE FUNCTION repoproof_reject_evidence_mutation();
