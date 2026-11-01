# Local and prepared CI quality gates

RPF-CI-001BE prepares a **manual-only local workflow definition**. It has not
been pushed, activated or executed on GitHub. Remote checks and branch
protection remain unverified. Publishing and execution require approval.

Use Node 24.x and `npm ci --ignore-scripts`, then `npm run check` in a reviewed
backend checkout. The gate explicitly generates Prisma, runs unit tests,
lint, typecheck, production build, full/production audits and positive/negative
lint compatibility. It stops at the first failure. It never invokes fixture
issue/regression scripts, seeding, Meta, a sandbox or arbitrary issue commands.
Use an independent review copy when preserving tracked generated Prisma files.

`.github/workflows/quality.yml` uses a disposable PostgreSQL 16 service, pinned
image digest, immutable action SHAs, Node 24, `contents: read` only, no saved
checkout credentials and a 15-minute job timeout. Test values are explicitly
synthetic; no production secret or repository secret is required. Database
integration suites remain sequential. They target only
`127.0.0.1:35440/rpf012s_disposable`; production bundle smoke uses port 15442.

## Cross-repository checkout

Backend and frontend are independent repositories. For a future approved
manual run, provide the **published** full lowercase frontend commit SHA as
`frontend_ref`. Checkout places them at sibling `backend/` and `frontend/`
paths. `REPOPROOF_BACKEND` points to the backend, whose history must include
frontend's contract pin `2571cfc7f19e8a0ab06d6e1fba10a5fdaeee0ce8`.
The backend gate compares all four **current candidate** contract files to the
frontend vendor bytes, then runs the frontend's historical `git show` pin
comparison. Passing an old pin alone cannot hide current backend contract drift.
Six regression cases cover matching snapshots, Windows Git checkout bytes,
exact consumer bytes and drift in each owned file. Only backend CRLF checkout
pairs are normalized; the frontend's pinned snapshot remains byte-exact.

Locally, set `REPOPROOF_FRONTEND` to the exact reviewed frontend worktree and run
`node scripts/check-contracts.mjs` from the backend. Local-only commits cannot
be checked out by GitHub until separately authorized publication occurs. Do
not replace the requested SHA with a branch tip, assume a commit is remote or
add broader credentials to make a missing checkout appear to pass. The current
public repository names were confirmed from each existing origin. If access
changes, treat cross-repository checkout as a pending permission prerequisite.

For local integration, create a **new disposable** PostgreSQL database at the
strict test target. Use only synthetic credentials and the documented core
environment, then run `prisma migrate deploy`, `prisma migrate status`, repeat
deploy, `tsx integration/rpf012d-drafts.ts`, `tsx integration/rpf012s-db.ts`
and `node integration/rpfstg001-production.mjs` with `RPF_STAGE_SMOKE=1`.
Never point these commands at an existing user database. See the pre-deployment
ledger for actual local command records; remote and deployed results are not
claimed.

Local acceptance on Node 24.22.2: `npm run check` passed 93 tests, lint,
typecheck, production build, both zero-finding audits and lint-toolchain checks.
Migration/status/repeat deploy, actual production bundle smoke and repeated
two-user draft/auth checks passed against the owned disposable PostgreSQL.
Draft integration now counts and cleans only users created by that invocation;
it preserves earlier synthetic users/drafts and retains isolation, CSRF,
constraint and zero-run assertions. This fixed a global-count assumption
exposed by an earlier failed browser run. Candidate-plus-pin parity passed in
the actual Git worktree; a source-only build copy cannot supply Git history.
YAML parsing and checks for manual triggers, pinned actions, read-only token
permissions and credential-free checkout passed. GitHub execution remains
pending publication and explicit approval. Local evidence: parent
`output/predeployment-2026-11-01/evidence/ci001be-*`.
