CREATE TABLE "ExecutionReconciliation" (
  "evidenceId" UUID PRIMARY KEY,
  "jobId" UUID NOT NULL REFERENCES "ExecutionJob"("id") ON DELETE RESTRICT,
  "effectId" UUID NOT NULL REFERENCES "ExecutionEffect"("id") ON DELETE RESTRICT,
  "jobVersion" INTEGER NOT NULL CHECK ("jobVersion">=0),
  "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('META','SANDBOX')),
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "cancelRequested" BOOLEAN NOT NULL,
  "deadlineAtMs" BIGINT NOT NULL CHECK ("deadlineAtMs" BETWEEN 0 AND 9007199254740991),
  "observerFingerprint" CHAR(64) NOT NULL CHECK ("observerFingerprint" ~ '^[a-f0-9]{64}$'),
  "keyId" VARCHAR(128) NOT NULL CHECK ("keyId" ~ '^[A-Za-z0-9_-]{1,128}$'),
  "source" VARCHAR(24) NOT NULL CHECK ("source" IN ('OFFLINE_SYNTHETIC','LIVE_PROVIDER')),
  "observedState" VARCHAR(16) NOT NULL CHECK ("observedState" IN ('UNKNOWN','NOT_FOUND','RUNNING','STOPPED','COMPLETED','FAILED','CANCELLED')),
  "providerIdentitySha256" CHAR(64) CHECK ("providerIdentitySha256" ~ '^[a-f0-9]{64}$'),
  "cleanupConfirmed" BOOLEAN NOT NULL,
  "noChargeConfirmed" BOOLEAN NOT NULL,
  "factsSha256" CHAR(64) NOT NULL CHECK ("factsSha256" ~ '^[a-f0-9]{64}$'),
  "observedAtMs" BIGINT NOT NULL CHECK ("observedAtMs" BETWEEN 0 AND 9007199254740991),
  "expiresAtMs" BIGINT NOT NULL CHECK ("expiresAtMs"<=9007199254740991 AND "expiresAtMs">"observedAtMs" AND "expiresAtMs"-"observedAtMs"<=300000),
  "payloadSha256" CHAR(64) NOT NULL UNIQUE CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
  "signature" CHAR(128) NOT NULL CHECK ("signature" ~ '^[a-f0-9]{128}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("effectId","observerFingerprint","factsSha256","observedAtMs"),
  CHECK (NOT "cleanupConfirmed" OR ("kind"='SANDBOX' AND "observedState" IN ('STOPPED','CANCELLED'))),
  CHECK (NOT "noChargeConfirmed" OR ("kind"='META' AND "observedState" IN ('COMPLETED','FAILED','CANCELLED'))),
  CHECK ("providerIdentitySha256" IS NOT NULL OR "observedState" IN ('UNKNOWN','NOT_FOUND'))
);
CREATE FUNCTION public.execution_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."ExecutionJob" j JOIN public."ExecutionEffect" e ON e."jobId"=j."id"
    WHERE j."id"=NEW."jobId" AND e."id"=NEW."effectId" AND j."version"=NEW."jobVersion" AND j."state"='QUARANTINED'
      AND e."kind"=NEW."kind" AND e."requestHash"=NEW."requestHash"
      AND j."cancelRequested"=NEW."cancelRequested" AND (extract(epoch FROM j."deadlineAt")*1000)::bigint=NEW."deadlineAtMs"
      AND NEW."observedAtMs">=floor(extract(epoch FROM e."createdAt")*1000))
    OR NEW."observedAtMs">floor(extract(epoch FROM clock_timestamp())*1000)
    OR NEW."expiresAtMs"<=floor(extract(epoch FROM clock_timestamp())*1000) THEN
    RAISE EXCEPTION 'Reconciliation identity or time rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_reconciliation_guard BEFORE INSERT ON "ExecutionReconciliation"
  FOR EACH ROW EXECUTE FUNCTION public.execution_reconciliation_guard();
REVOKE ALL ON FUNCTION public.execution_reconciliation_guard() FROM PUBLIC;
REVOKE ALL ON "ExecutionReconciliation" FROM PUBLIC;
-- Append-only observer-role grants are separate. No job/effect transition,
-- quarantine release, provider dispatch, successful run or verdict is created.
