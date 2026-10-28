# RepoProof - Canonical Two-Repository Task Board

**Canonical tracked location:** `repoproof_backend/docs/TASK_BOARD.md`. **Owner:** backend Git repository. **Architecture:** two existing, independent Git repositories, NOT a monorepo.

**Evidence policy:** `TODO` here means *not yet independently verified against existing code*, not necessarily unimplemented. Before implementing, inspect actual source/tests and existing user changes. Mark DONE only with real observed test evidence and relevant code SHA(s). Never fabricate success based on old docs or generated files. Parent `docs/TASK_BOARD.md` (if any) is historical, noncanonical.

Status options: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`. Edit one ticket at a time and keep previous evidence.

## Setup and foundation (two-repo replacement for old RPF-001)

| Ticket | Repo | Status | Depends | Acceptance evidence / meaning | Code SHA / checks |
| --- | --- | --- | --- | --- | --- |
| RPF-001A | frontend | TODO | - | Verify or establish quality gates for EXISTING frontend: TypeScript, lint, tests and build using real scripts; preserve current app | - |
| RPF-001B | backend | DONE | - | Existing backend quality gates verified; JWT negative tests added | 05fd51f297c69cbb1659c28c2dd64df2f00d0c81; npm run lint and typecheck passed; npm test -- --maxWorkers=1: 9 passed (7 in untracked RPF-001C tests, 2 committed JWT tests); isolated copy excluding RPF-001C: lint, typecheck, 2 JWT tests and build passed; git diff --check passed |
| RPF-001C | backend | IN_PROGRESS | RPF-001B | Backend-owned API contract/DTO strategy, runtime validation, versioning and documented frontend compatibility checks; do not force monorepo sharing | Backend `97a2c52ba6827ccd0f25a06f1933d3865f9bc44c`; frontend `e9a4a6e267b3e2f3c4b3dcaa881de00f2414ed86`. Contract snapshot matches backend commit; backend contract tests 14/14 and full suite 16/16; frontend tests 6/6. Both commits report lint, typecheck and isolated build passed. Live endpoint integration remains unverified; see evidence below. |

### RPF-001C reconciliation evidence

- Rechecked the frontend commit-pinned byte comparison against both backend contract files and reran the backend and frontend tests above; all passed with no skips. The checks validate proposed DTOs with sample data, not live HTTP integration.
- The backend commit records ESLint, typecheck, isolated production build, diff checks, and staged secret review. The frontend commit records the same gates and its compatibility check. These are commit-time results; builds and lint were not rerun during this documentation reconciliation.
- `/api/v1` business run routes are not implemented. Actual frontend-to-backend request, response, authorization, and error-envelope compatibility remains unverified until those endpoints and consumers exist. Existing backend errors differ from the proposed v1 envelope. Repository and issue lists, cancellation responses, and history lack finalized DTO shapes. Keep RPF-001C IN_PROGRESS pending integration proof; later run API work is tracked by RPF-012A/RPF-012B.
- At RPF-001C reconciliation, `RPF-SEC-001` was a separate pending P0 security issue. Contract checks did not test CSRF, cookie, or CORS concerns; see the security ticket below for its current status.

## Existing RepoProof v2 backlog (preserve original RPF ticket meaning)

| Ticket | Repo | Status | Depends | Acceptance evidence / meaning | Code SHA / checks |
| --- | --- | --- | --- | --- | --- |
| RPF-010A | backend | TODO | RPF-001B | Pure verdict policy and negative tests reject false VERIFIED results | - |
| RPF-002 | backend | TODO | RPF-001B | Owned pinned JS/TS fixture, real failing issue test, known manual fix | - |
| RPF-003 | backend | TODO | RPF-001B | Real Meta API adapter smoke when credentials/budget approved; structured errors and secret safety | - |
| RPF-004 | backend | TODO | RPF-002 | Separate isolated allowlisted fixture runner; fixed commands, timeouts, cleanup | - |
| RPF-005 | backend | TODO | RPF-004 | Structured test results parse executed/skipped/failure and malformed JSON | - |
| RPF-006A | backend | TODO | RPF-003 | Meta issue triage with schema validation and read limits | - |
| RPF-006B | backend | TODO | RPF-004, RPF-005, RPF-006A | Test generated and frozen before patch; bytes/hash verified | - |
| RPF-007 | backend | TODO | RPF-006B | Failing baseline assertion or honest NO_REPRO, with zero patch on NO_REPRO | - |
| RPF-008 | backend | TODO | RPF-003, RPF-007 | Bounded source-only patch with path, test and lockfile protection | - |
| RPF-009 | backend | TODO | RPF-008 | Independent retest of frozen reproducer and regressions with hashes | - |
| RPF-010B | backend | TODO | RPF-010A, RPF-009 | Real artifacts drive four deterministic verdicts, never model claim | - |
| RPF-011A | backend | TODO | RPF-001B | Persistence schema/migrations for immutable run evidence as supported by actual stack | - |
| RPF-011B | backend | TODO | RPF-011A, RPF-010B | Durable orchestrator and job lifecycle tests | - |
| RPF-012A | backend | TODO | RPF-011B, RPF-001C | Read-only issue selection, create/approve/cancel APIs with auth and contracts | - |
| RPF-012B | backend | TODO | RPF-012A | Authenticated events/reports/artifacts APIs with integrity checks | - |
| RPF-013A | frontend | TODO | RPF-001A, RPF-001C, RPF-012A | Existing UI extended with issue selection and approval; real APIs, loading/errors, a11y | - |
| RPF-013B | frontend | TODO | RPF-013A, RPF-012B | Live evidence timeline, diff and honest four-verdict report from actual API | - |
| RPF-014 | cross-repo | TODO | RPF-010B, RPF-013B | False-fix and no-repro scenarios; SPLIT into -BE/-FE before code work | - |
| RPF-015 | cross-repo | TODO | RPF-014 | Security + fresh checkout E2E; SPLIT into scoped tickets before code work | - |
| RPF-016 | cross-repo | TODO | RPF-015 | Demo/release docs, authentic model evidence; SPLIT or explicitly own tracked artifacts | - |

## Pending security issue

- **RPF-SEC-001 — P0 DONE: authentication and cookie security.** Better Auth CSRF and origin checks are enabled; cookies are HttpOnly with environment-appropriate Secure/SameSite/Path attributes; CORS uses explicit configured origins. This commit: full suite 20 passed; Prisma-backed registration, login, failed login, session, logout, CSRF, both cookie modes and CORS passed against the confirmed disposable test database; synthetic data removed. Migration status, ESLint, typecheck, isolated production build and diff checks passed. Deployed browser, OAuth and future frontend proxy integration remain unverified; see `docs/AUTH_SECURITY.md`.

## Cross-repo tracking rules

- **Backend-only**: include this board's truthful ticket status and check evidence in the same backend code commit.
- **Frontend-only**: create one frontend code commit with true checks; create a **separate backend tracking-only commit** to record its SHA/evidence here. Until both exist, status is `IN_PROGRESS` or record `CODE_COMMITTED / TRACKING_PENDING`; never claim atomicity.
- **Cross-repo**: split into `-BE`/`-FE` subtickets with independent acceptance. Parent is DONE only when both code SHAs and integration proof are recorded. Do not invent a third repository.
- Existing user changes may already implement some tickets. Audit/verify them and classify; never reimplement blindly or rewrite prior commits.

## Example verified entry (illustrative, do NOT claim it happened)

`RPF-013A | frontend | DONE | ... | UI and API contract tests pass | Frontend abc123...; checks: <actual commands>; backend tracking commit def456...`

## Standard ticket closeout

- Actual repository, branch and commit SHA(s)
- Exact observed test commands, passed/failed/skipped totals; residual untested risks
- Files committed and any pre-existing unrelated dirty files preserved
- Evidence artifacts without secrets and explicit provenance
- Related backend board commit SHA for frontend work (where applicable)
