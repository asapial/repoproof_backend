CREATE TABLE public."MetaAttemptAccounting" (
  "effectId" UUID PRIMARY KEY REFERENCES public."ExecutionEffect"("id") ON DELETE RESTRICT,
  "jobId" UUID NOT NULL UNIQUE REFERENCES public."ExecutionJob"("id") ON DELETE RESTRICT,
  "jobVersion" INTEGER NOT NULL CHECK ("jobVersion">=0),
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "model" VARCHAR(128) NOT NULL CHECK ("model" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  "maxOutputTokens" INTEGER NOT NULL CHECK ("maxOutputTokens" BETWEEN 1 AND 65536),
  "source" VARCHAR(24) NOT NULL CHECK ("source" IN ('OFFLINE_SYNTHETIC','LIVE_UNVERIFIED')),
  "intentSha256" CHAR(64) NOT NULL CHECK ("intentSha256" ~ '^[a-f0-9]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION public.meta_accounting_intent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."ExecutionJob" j JOIN public."ExecutionEffect" e ON e."jobId"=j."id"
    WHERE e."id"=NEW."effectId" AND j."id"=NEW."jobId" AND j."version"=NEW."jobVersion" AND e."kind"='META'
      AND e."requestHash"=NEW."requestHash" AND j."state"='QUARANTINED'
      AND NOT j."cancelRequested" AND j."deadlineAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'Meta accounting identity or job rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meta_accounting_intent_guard BEFORE INSERT ON public."MetaAttemptAccounting"
  FOR EACH ROW EXECUTE FUNCTION public.meta_accounting_intent_guard();
CREATE TABLE public."MetaUsageObservation" (
  "effectId" UUID PRIMARY KEY REFERENCES public."MetaAttemptAccounting"("effectId") ON DELETE RESTRICT,
  "outcome" VARCHAR(16) NOT NULL CHECK ("outcome" IN ('RECEIVED','REJECTED','UNCERTAIN')),
  "usagePresent" BOOLEAN NOT NULL,
  "promptTokens" BIGINT CHECK ("promptTokens" BETWEEN 0 AND 9007199254740991),
  "completionTokens" BIGINT CHECK ("completionTokens" BETWEEN 0 AND 9007199254740991),
  "totalTokens" BIGINT CHECK ("totalTokens" BETWEEN 0 AND 9007199254740991),
  "cachedTokens" BIGINT CHECK ("cachedTokens" BETWEEN 0 AND 9007199254740991),
  "reasoningTokens" BIGINT CHECK ("reasoningTokens" BETWEEN 0 AND 9007199254740991),
  "observationSha256" CHAR(64) NOT NULL CHECK ("observationSha256" ~ '^[a-f0-9]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((NOT "usagePresent" AND "promptTokens" IS NULL AND "completionTokens" IS NULL AND "totalTokens" IS NULL
      AND "cachedTokens" IS NULL AND "reasoningTokens" IS NULL)
    OR ("usagePresent" AND "promptTokens" IS NOT NULL AND "completionTokens" IS NOT NULL AND "totalTokens" IS NOT NULL
      AND "totalTokens"="promptTokens"+"completionTokens"
      AND ("cachedTokens" IS NULL OR "cachedTokens"<="promptTokens")
      AND ("reasoningTokens" IS NULL OR "reasoningTokens"<="completionTokens")))
);
CREATE TRIGGER meta_accounting_immutable BEFORE UPDATE OR DELETE ON public."MetaAttemptAccounting"
  FOR EACH ROW EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
CREATE TRIGGER meta_accounting_no_truncate BEFORE TRUNCATE ON public."MetaAttemptAccounting"
  FOR EACH STATEMENT EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
CREATE TRIGGER meta_usage_immutable BEFORE UPDATE OR DELETE ON public."MetaUsageObservation"
  FOR EACH ROW EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
CREATE TRIGGER meta_usage_no_truncate BEFORE TRUNCATE ON public."MetaUsageObservation"
  FOR EACH STATEMENT EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
REVOKE ALL ON FUNCTION public.meta_accounting_intent_guard() FROM PUBLIC;
REVOKE ALL ON public."MetaAttemptAccounting",public."MetaUsageObservation" FROM PUBLIC;
-- Accounting is not a no-charge entitlement, reservation, retry or verdict.
