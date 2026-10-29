\set ON_ERROR_STOP on
-- Run only in a disposable database. All data is synthetic.
CREATE FUNCTION pg_temp.expect_failure(command text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
  END;
  IF actual IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION 'Expected SQLSTATE %, got % for %', expected_state, actual, command;
  END IF;
END $$;
INSERT INTO "Repository" (id,"githubRepoId",owner,name,"fullName","defaultBranch","updatedAt") VALUES ('repo1',1,'owner','one','owner/one','main',now()), ('repo2',2,'owner','two','owner/two','main',now());
INSERT INTO "IssueSnapshot" (id,"repositoryId",number,title,body,"issueUrl") VALUES ('issue1','repo1',1,'title','body','https://example.test/1'), ('issue2','repo2',2,'title','body','https://example.test/2');
INSERT INTO "Run" (id,"repositoryId","issueSnapshotId","baseSha","fixtureKey","updatedAt") VALUES ('run1','repo1','issue1',repeat('a',40),'fixture',now()), ('run2','repo2','issue2',repeat('b',40),'fixture2',now());
SELECT pg_temp.expect_failure($q$INSERT INTO "Run" (id,"repositoryId","issueSnapshotId","baseSha","fixtureKey","updatedAt") VALUES ('invalid','repo1','issue2',repeat('a',40),'fixture',now())$q$, '23503');
SELECT pg_temp.expect_failure($q$INSERT INTO "Run" (id,"repositoryId","issueSnapshotId","baseSha","fixtureKey","updatedAt") VALUES ('invalid','repo1','issue1','bad','fixture',now())$q$, '23514');
SELECT pg_temp.expect_failure($q$UPDATE "Run" SET "baseSha"=repeat('b',40) WHERE id='run1'$q$, '55000');
UPDATE "Run" SET state='ANALYZING', version=1 WHERE id='run1';
SELECT pg_temp.expect_failure($q$UPDATE "IssueSnapshot" SET body='changed' WHERE id='issue1'$q$, '55000');
SELECT pg_temp.expect_failure($q$DELETE FROM "IssueSnapshot" WHERE id='issue1'$q$, '55000');
INSERT INTO "ReproductionTest" (id,"runId",origin,"testId","relativePath","storageKey",sha256,"runnerImageDigest","commandManifestSha256","lockedAt") VALUES ('rep1','run1','CURATED','test','test.js','frozen/1',repeat('c',64),'sha256:'||repeat('d',64),repeat('e',64),now());
SELECT pg_temp.expect_failure($q$UPDATE "ReproductionTest" SET sha256=repeat('d',64) WHERE id='rep1'$q$, '55000');
SELECT pg_temp.expect_failure($q$INSERT INTO "ReproductionTest" (id,"runId",origin,"testId","relativePath","storageKey",sha256,"runnerImageDigest","commandManifestSha256","lockedAt") VALUES ('rep2','run2','CURATED','test','test.js','frozen/2','bad','sha256:'||repeat('d',64),repeat('e',64),now())$q$, '23514');
INSERT INTO "PatchAttempt" (id,"runId","attemptNumber") VALUES ('attempt1','run1',1);
SELECT pg_temp.expect_failure($q$INSERT INTO "PatchAttempt" (id,"runId","attemptNumber") VALUES ('attempt3','run1',3)$q$, '23514');
SELECT pg_temp.expect_failure($q$INSERT INTO "PatchAttempt" (id,"runId","attemptNumber") VALUES ('attemptdup','run1',1)$q$, '23505');
INSERT INTO "TestExecution" (id,"runId","attemptId",phase,outcome,"runnerImageDigest","commandManifestSha256",collected,executed,passed,"durationMs") VALUES ('exec1','run1','attempt1','PATCHED_REPRO','PASSED','sha256:'||repeat('d',64),repeat('e',64),1,1,1,5);
SELECT pg_temp.expect_failure($q$INSERT INTO "TestExecution" (id,"runId","attemptId",phase,outcome,"runnerImageDigest","commandManifestSha256","durationMs") VALUES ('bad','run2','attempt1','PATCHED_REPRO','ERROR','sha256:'||repeat('d',64),repeat('e',64),5)$q$, '23503');
SELECT pg_temp.expect_failure($q$UPDATE "TestExecution" SET passed=0 WHERE id='exec1'$q$, '55000');
INSERT INTO "Artifact" (id,"runId",kind,"storageKey",sha256,"mediaType","byteSize") VALUES ('artifact1','run1','FROZEN_TEST','private/1',repeat('c',64),'text/plain',10);
SELECT pg_temp.expect_failure($q$DELETE FROM "Artifact" WHERE id='artifact1'$q$, '55000');
SELECT pg_temp.expect_failure($q$INSERT INTO "Artifact" (id,"runId",kind,"storageKey",sha256,"mediaType","byteSize") VALUES ('bad','run1','FROZEN_TEST','private/2',repeat('c',64),'text/plain',-1)$q$, '23514');
INSERT INTO "RunEvent" ("runId",seq,stage,type,title) VALUES ('run1',1,'CREATED','created','Created');
SELECT pg_temp.expect_failure($q$INSERT INTO "RunEvent" ("runId",seq,stage,type,title) VALUES ('run1',1,'CREATED','created','Duplicate')$q$, '23505');
SELECT pg_temp.expect_failure($q$UPDATE "RunEvent" SET title='changed' WHERE "runId"='run1'$q$, '55000');
INSERT INTO "VerificationReport" (id,"runId",verdict,"reasonCode","scopeStatement","policyVersion","evidenceJson","limitationsJson","reportSha256") VALUES ('report1','run1','INCONCLUSIVE','RUNNER_UNAVAILABLE','No runner','1','{}','[]',repeat('f',64));
SELECT pg_temp.expect_failure($q$UPDATE "VerificationReport" SET verdict='VERIFIED' WHERE id='report1'$q$, '55000');
SELECT pg_temp.expect_failure($q$TRUNCATE TABLE "RunEvent"$q$, '55000');
SELECT pg_temp.expect_failure($q$INSERT INTO "TestExecution" (id,"runId",phase,outcome,"runnerImageDigest","commandManifestSha256",collected,executed,passed,"durationMs") VALUES ('badcounts','run1','BASELINE_REPRO','PASSED','sha256:'||repeat('d',64),repeat('e',64),0,1,1,5)$q$, '23514');
SELECT pg_temp.expect_failure($q$INSERT INTO "RunEvent" ("runId",seq,stage,type,title) VALUES ('run1',0,'CREATED','created','Bad')$q$, '23514');
INSERT INTO "RunApproval" (id,"runId") VALUES ('approval1','run1');
SELECT pg_temp.expect_failure($q$UPDATE "RunApproval" SET decision='APPROVED' WHERE id='approval1'$q$, '23514');
UPDATE "RunApproval" SET decision='APPROVED', "decidedAt"=now() WHERE id='approval1';
SELECT pg_temp.expect_failure($q$UPDATE "RunApproval" SET decision='REJECTED' WHERE id='approval1'$q$, '55000');
SELECT pg_temp.expect_failure($q$DELETE FROM "RunApproval" WHERE id='approval1'$q$, '55000');
UPDATE "PatchAttempt" SET "completedAt"=now() WHERE id='attempt1';
SELECT pg_temp.expect_failure($q$UPDATE "PatchAttempt" SET "changedLines"=2 WHERE id='attempt1'$q$, '55000');
SELECT pg_temp.expect_failure($q$TRUNCATE TABLE "PatchAttempt" CASCADE$q$, '55000');
SELECT 'evidence persistence assertions passed' AS result;
