CREATE TABLE public."FrozenPreparationPackage" (
  "id" UUID PRIMARY KEY,
  "purpose" VARCHAR(32) NOT NULL DEFAULT 'PREPARATION_ONLY' CHECK ("purpose"='PREPARATION_ONLY'),
  "manifestSha256" CHAR(64) NOT NULL UNIQUE CHECK ("manifestSha256" ~ '^[a-f0-9]{64}$'),
  "payloadSha256" CHAR(64) NOT NULL UNIQUE CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
  "payload" BYTEA NOT NULL CHECK (octet_length("payload") BETWEEN 1 AND 65536),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (encode(sha256("payload"),'hex')="payloadSha256")
);
CREATE TRIGGER frozen_preparation_immutable BEFORE UPDATE OR DELETE ON public."FrozenPreparationPackage"
  FOR EACH ROW EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
CREATE TRIGGER frozen_preparation_no_truncate BEFORE TRUNCATE ON public."FrozenPreparationPackage"
  FOR EACH STATEMENT EXECUTE FUNCTION public.repoproof_reject_evidence_mutation();
REVOKE ALL ON public."FrozenPreparationPackage" FROM PUBLIC;
-- Standalone immutable preparation bytes only, not product Run/artifact evidence.
-- No retention bypass, patch metadata mutation, runner permission or verdict.
