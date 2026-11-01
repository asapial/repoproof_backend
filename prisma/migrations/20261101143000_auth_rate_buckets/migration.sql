CREATE TABLE "AuthRateBucket" (
  "key" VARCHAR(64) PRIMARY KEY,
  "count" INTEGER NOT NULL CHECK ("count" >= 1 AND "count" <= 10000),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AuthRateBucket_expiresAt_idx" ON "AuthRateBucket"("expiresAt");
