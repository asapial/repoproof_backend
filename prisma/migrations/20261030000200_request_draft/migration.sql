-- Drafts are saved selections, never run or evidence records.
CREATE TABLE "RequestDraft" (
  "userId" TEXT NOT NULL,
  "repositoryId" VARCHAR(128) NOT NULL,
  "fixtureKey" VARCHAR(128) NOT NULL,
  "issueNumber" INTEGER NOT NULL,
  CONSTRAINT "RequestDraft_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "RequestDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequestDraft_repositoryId_check" CHECK ("repositoryId" ~ '^[a-z0-9-]{1,128}$'),
  CONSTRAINT "RequestDraft_fixtureKey_check" CHECK ("fixtureKey" ~ '^[a-z0-9-]{1,128}$'),
  CONSTRAINT "RequestDraft_issueNumber_check" CHECK ("issueNumber" > 0)
);
