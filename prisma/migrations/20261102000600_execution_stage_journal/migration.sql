CREATE TABLE public."ExecutionStageJournal" (
  "flowId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" BETWEEN 0 AND 15),
  "previousSha256" CHAR(64) NOT NULL CHECK ("previousSha256" ~ '^[a-f0-9]{64}$'),
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "deadlineAtMs" BIGINT NOT NULL CHECK ("deadlineAtMs" BETWEEN 0 AND 9007199254740991),
  "kind" VARCHAR(24) NOT NULL,
  "outcome" VARCHAR(24) NOT NULL,
  "referenceSha256" CHAR(64) NOT NULL CHECK ("referenceSha256" ~ '^[a-f0-9]{64}$'),
  "frozenPackageId" UUID REFERENCES public."FrozenPreparationPackage"("id") ON DELETE RESTRICT,
  "frozenManifestSha256" CHAR(64) CHECK ("frozenManifestSha256" ~ '^[a-f0-9]{64}$'),
  "state" VARCHAR(32) NOT NULL,
  "cancelRequested" BOOLEAN NOT NULL,
  "payload" BYTEA NOT NULL CHECK (octet_length("payload") BETWEEN 1 AND 4096),
  "recordSha256" CHAR(64) NOT NULL CHECK (encode(sha256("payload"),'hex')="recordSha256"),
  "recordedAtMs" BIGINT NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000),
  PRIMARY KEY ("flowId","sequence")
);
CREATE FUNCTION public.execution_stage_journal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  prior public."ExecutionStageJournal"%ROWTYPE;
  same public."ExecutionStageJournal"%ROWTYPE;
  expected_state TEXT;
  required_state TEXT;
  is_terminal BOOLEAN;
  p JSONB;
BEGIN
  p := convert_from(NEW."payload",'UTF8')::jsonb;
  IF p IS DISTINCT FROM jsonb_build_object('version','rpf-stage-journal-v1','mode','OFFLINE_PREPARATION',
    'flowId',NEW."flowId",'sequence',NEW."sequence",'previousSha256',NEW."previousSha256",'requestHash',NEW."requestHash",'deadlineAtMs',NEW."deadlineAtMs",
    'kind',NEW."kind",'outcome',NEW."outcome",'referenceSha256',NEW."referenceSha256",'frozenPackageId',NEW."frozenPackageId",
    'frozenManifestSha256',NEW."frozenManifestSha256",'state',NEW."state",'cancelRequested',NEW."cancelRequested") THEN
    RAISE EXCEPTION 'Stage payload rejected' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."flowId"::text,602));
  NEW."recordedAtMs" := floor(extract(epoch FROM clock_timestamp())*1000);
  SELECT * INTO same FROM public."ExecutionStageJournal" WHERE "flowId"=NEW."flowId" AND "sequence"=NEW."sequence";
  IF FOUND THEN
    IF same."payload"=NEW."payload" AND same."recordSha256"=NEW."recordSha256" THEN
      NEW."recordedAtMs" := same."recordedAtMs"; RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Stage identity conflict' USING ERRCODE='23514';
  END IF;
  SELECT * INTO prior FROM public."ExecutionStageJournal" WHERE "flowId"=NEW."flowId" ORDER BY "sequence" DESC LIMIT 1;
  IF NOT FOUND THEN
    IF NEW."sequence"<>0 OR NEW."previousSha256"<>repeat('0',64) OR NEW."kind"<>'OPEN' OR NEW."outcome"<>'NONE' OR NEW."state"<>'OPEN'
      OR NEW."cancelRequested" OR NEW."frozenPackageId" IS NOT NULL OR NEW."frozenManifestSha256" IS NOT NULL OR NEW."referenceSha256"<>NEW."requestHash"
      OR NEW."deadlineAtMs"<=NEW."recordedAtMs" OR NEW."deadlineAtMs">NEW."recordedAtMs"+3600000 THEN
      RAISE EXCEPTION 'Stage opening rejected' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."sequence"<>prior."sequence"+1 OR NEW."previousSha256"<>prior."recordSha256" OR NEW."requestHash"<>prior."requestHash" OR NEW."deadlineAtMs"<>prior."deadlineAtMs" THEN
    RAISE EXCEPTION 'Stage chain rejected' USING ERRCODE='23514';
  END IF;
  is_terminal := prior."state" IN ('AWAITING_TRUST_REVIEW','NO_REPRO_PREPARATION','REJECTED_PREPARATION','INCONCLUSIVE','QUARANTINED','CANCELLED','EXPIRED');
  IF NEW."kind"='CANCEL' THEN
    IF NEW."outcome"<>'NONE' OR prior."cancelRequested" OR (is_terminal AND prior."state"<>'QUARANTINED') THEN
      RAISE EXCEPTION 'Stage cancellation rejected' USING ERRCODE='23514';
    END IF;
    expected_state := CASE WHEN prior."state"='QUARANTINED' THEN 'QUARANTINED' ELSE 'CANCELLED' END;
  ELSIF NEW."kind"='EXPIRE' THEN
    IF NEW."outcome"<>'NONE' OR is_terminal OR NEW."recordedAtMs"<prior."deadlineAtMs" THEN
      RAISE EXCEPTION 'Stage expiry rejected' USING ERRCODE='23514';
    END IF;
    expected_state := 'EXPIRED';
  ELSE
    IF is_terminal OR prior."cancelRequested" OR NEW."recordedAtMs">=prior."deadlineAtMs" THEN
      RAISE EXCEPTION 'Terminal or expired stage rejected' USING ERRCODE='23514';
    END IF;
    required_state := CASE NEW."kind" WHEN 'INTAKE' THEN 'OPEN' WHEN 'FREEZE' THEN 'INTAKE_ACCEPTED' WHEN 'BASELINE_ISSUE' THEN 'FROZEN'
      WHEN 'BASELINE_REGRESSIONS' THEN 'BASELINE_FAILED' WHEN 'PATCH_PREPARED' THEN 'BASELINE_CLEAR' WHEN 'PATCHED_ISSUE' THEN 'PATCH_READY' WHEN 'PATCHED_REGRESSIONS' THEN 'PATCHED_PASS' END;
    IF required_state IS NULL OR required_state<>prior."state" THEN
      RAISE EXCEPTION 'Stage order rejected' USING ERRCODE='23514';
    END IF;
    IF NEW."outcome" IN ('UNCERTAIN','INCONCLUSIVE') THEN
      expected_state := CASE NEW."outcome" WHEN 'UNCERTAIN' THEN 'QUARANTINED' ELSE 'INCONCLUSIVE' END;
    ELSIF NEW."kind" IN ('INTAKE','FREEZE','PATCH_PREPARED') THEN
      IF NEW."outcome" NOT IN ('ALLOWED','DENIED') THEN RAISE EXCEPTION 'Stage outcome rejected' USING ERRCODE='23514'; END IF;
      expected_state := CASE WHEN NEW."outcome"='DENIED' THEN 'REJECTED_PREPARATION' WHEN NEW."kind"='INTAKE' THEN 'INTAKE_ACCEPTED' WHEN NEW."kind"='FREEZE' THEN 'FROZEN' ELSE 'PATCH_READY' END;
    ELSE
      IF NEW."outcome" NOT IN ('PASS','ASSERTION_FAILURE') THEN RAISE EXCEPTION 'Stage outcome rejected' USING ERRCODE='23514'; END IF;
      expected_state := CASE WHEN NEW."kind"='BASELINE_ISSUE' THEN CASE NEW."outcome" WHEN 'PASS' THEN 'NO_REPRO_PREPARATION' ELSE 'BASELINE_FAILED' END
        WHEN NEW."outcome"<>'PASS' THEN 'INCONCLUSIVE' WHEN NEW."kind"='BASELINE_REGRESSIONS' THEN 'BASELINE_CLEAR' WHEN NEW."kind"='PATCHED_ISSUE' THEN 'PATCHED_PASS' ELSE 'AWAITING_TRUST_REVIEW' END;
    END IF;
  END IF;
  IF NEW."state"<>expected_state OR NEW."cancelRequested"<>(prior."cancelRequested" OR NEW."kind"='CANCEL') THEN
    RAISE EXCEPTION 'Stage state rejected' USING ERRCODE='23514';
  END IF;
  IF NEW."kind"='FREEZE' AND NEW."outcome"='ALLOWED' THEN
    IF NEW."frozenPackageId" IS NULL OR NEW."frozenManifestSha256" IS NULL OR NEW."referenceSha256"<>NEW."frozenManifestSha256"
      OR NOT EXISTS(SELECT 1 FROM public."FrozenPreparationPackage" WHERE "id"=NEW."frozenPackageId" AND "manifestSha256"=NEW."frozenManifestSha256") THEN
      RAISE EXCEPTION 'Durable freeze rejected' USING ERRCODE='23514';
    END IF;
  ELSIF NEW."frozenPackageId" IS DISTINCT FROM prior."frozenPackageId" OR NEW."frozenManifestSha256" IS DISTINCT FROM prior."frozenManifestSha256" THEN
    RAISE EXCEPTION 'Frozen identity changed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_stage_journal_guard BEFORE INSERT ON public."ExecutionStageJournal"
  FOR EACH ROW EXECUTE FUNCTION public.execution_stage_journal_guard();
CREATE TRIGGER execution_stage_journal_immutable BEFORE UPDATE OR DELETE ON public."ExecutionStageJournal"
  FOR EACH ROW EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
CREATE TRIGGER execution_stage_journal_no_truncate BEFORE TRUNCATE ON public."ExecutionStageJournal"
  FOR EACH STATEMENT EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
REVOKE ALL ON FUNCTION public.execution_stage_journal_guard() FROM PUBLIC;
REVOKE ALL ON public."ExecutionStageJournal" FROM PUBLIC;
-- Ordered preparation references only. No Run, verdict, lease, provider dispatch,
-- actual execution evidence, possible-effect release or no-charge authority.
