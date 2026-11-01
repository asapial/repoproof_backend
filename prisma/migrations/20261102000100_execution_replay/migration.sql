CREATE TABLE "ExecutionReplayGroup" (
  "namespace" VARCHAR(32) NOT NULL CHECK ("namespace" IN ('ISOLATION','RUNNER_REQUEST','RUNNER_EVIDENCE')),
  "groupId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("namespace", "groupId"),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '5 minutes')
);
CREATE TABLE "ExecutionReplayItem" (
  "namespace" VARCHAR(32) NOT NULL,
  "itemId" UUID NOT NULL,
  "nonce" CHAR(64) NOT NULL CHECK ("nonce" ~ '^[a-f0-9]{64}$'),
  "groupId" UUID NOT NULL,
  PRIMARY KEY ("namespace", "itemId"),
  UNIQUE ("namespace", "nonce"),
  FOREIGN KEY ("namespace", "groupId") REFERENCES "ExecutionReplayGroup"("namespace", "groupId") ON DELETE RESTRICT
);
-- No ordinary API runtime grants, automatic deletion or expiry-based rearming.
