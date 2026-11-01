CREATE TABLE "ExecutionJob" (
  "id" UUID PRIMARY KEY,
  "ownerId" VARCHAR(128) NOT NULL CHECK (length("ownerId") BETWEEN 1 AND 128),
  "idempotencyKey" UUID NOT NULL,
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "state" VARCHAR(16) NOT NULL DEFAULT 'QUEUED' CHECK ("state" IN ('QUEUED','LEASED','QUARANTINED','CANCELLED','EXPIRED')),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 3),
  "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
  "leaseHash" CHAR(64) CHECK ("leaseHash" ~ '^[a-f0-9]{64}$'),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  UNIQUE ("ownerId","idempotencyKey"),
  CHECK ("deadlineAt" > "createdAt" AND "deadlineAt" <= "createdAt" + interval '5 minutes'),
  CHECK (("state"='LEASED' AND "leaseHash" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" <= "deadlineAt")
    OR ("state"<>'LEASED' AND "leaseHash" IS NULL AND "leaseExpiresAt" IS NULL))
);
-- Quarantine retains the global slot, including after a process/lease expires.
CREATE UNIQUE INDEX "ExecutionJob_one_active" ON "ExecutionJob" ((true))
  WHERE "state" IN ('LEASED','QUARANTINED');
CREATE INDEX "ExecutionJob_queue" ON "ExecutionJob" ("createdAt","id") WHERE "state"='QUEUED';
CREATE TABLE "ExecutionEffect" (
  "id" UUID PRIMARY KEY,
  "jobId" UUID NOT NULL UNIQUE REFERENCES "ExecutionJob"("id") ON DELETE RESTRICT,
  "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('META','SANDBOX')),
  "requestHash" CHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION execution_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."deadlineAt" IS DISTINCT FROM OLD."deadlineAt"
    OR NEW."version" <> OLD."version" + 1 OR NEW."attempts" < OLD."attempts"
    OR (OLD."cancelRequested" AND NOT NEW."cancelRequested")
    OR OLD."state" IN ('CANCELLED','EXPIRED')
    OR (OLD."state"='QUARANTINED' AND NEW."state"<>'QUARANTINED')
    OR (EXISTS(SELECT 1 FROM "ExecutionEffect" WHERE "jobId"=OLD."id") AND NEW."state"<>'QUARANTINED') THEN
    RAISE EXCEPTION 'Execution job transition rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_job_guard BEFORE UPDATE ON "ExecutionJob"
  FOR EACH ROW EXECUTE FUNCTION execution_job_guard();
CREATE FUNCTION execution_effect_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "ExecutionJob" SET "state"='QUARANTINED',"version"="version"+1,
    "leaseHash"=NULL,"leaseExpiresAt"=NULL WHERE "id"=NEW."jobId" AND "state"='LEASED'
    AND NOT "cancelRequested" AND "leaseExpiresAt">clock_timestamp() AND "deadlineAt">clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execution effect requires a live lease' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_effect_quarantine AFTER INSERT ON "ExecutionEffect"
  FOR EACH ROW EXECUTE FUNCTION execution_effect_quarantine();
REVOKE ALL ON FUNCTION execution_job_guard(),execution_effect_quarantine() FROM PUBLIC;
-- No automatic quarantine release, effect deletion or ordinary API role grants.
