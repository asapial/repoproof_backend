# RepoProof - Canonical Two-Repository Task Board

**Canonical tracked location:** `repoproof_backend/docs/TASK_BOARD.md`. **Owner:** backend Git repository. **Architecture:** two existing, independent Git repositories, NOT a monorepo.

**Evidence policy:** `TODO` here means *not yet independently verified against existing code*, not necessarily unimplemented. Before implementing, inspect actual source/tests and existing user changes. Mark DONE only with real observed test evidence and relevant code SHA(s). Never fabricate success based on old docs or generated files. Parent `docs/TASK_BOARD.md` (if any) is historical, noncanonical.

Status options: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`. Edit one ticket at a time and keep previous evidence.

## Setup and foundation (two-repo replacement for old RPF-001)

| Ticket | Repo | Status | Depends | Acceptance evidence / meaning | Code SHA / checks |
| --- | --- | --- | --- | --- | --- |
| RPF-001A | frontend | TODO | - | Verify or establish quality gates for EXISTING frontend: TypeScript, lint, tests and build using real scripts; preserve current app | - |
| RPF-001B | backend | DONE | - | Existing backend quality gates verified; JWT negative tests added | This commit; npm run lint and typecheck passed; npm test -- --maxWorkers=1: 9 passed (7 in untracked RPF-001C tests, 2 committed JWT tests); isolated copy excluding RPF-001C: lint, typecheck, 2 JWT tests and build passed; git diff --check passed |
| RPF-001C | backend | TODO | RPF-001B | Backend-owned API contract/DTO strategy, runtime validation, versioning and documented frontend compatibility checks; do not force monorepo sharing | - |

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

- **TODO: authentication and cookie security review.** Better Auth sets `disableCSRFCheck: true` and `httpOnly: false`; CORS accepts all HTTPS Vercel subdomains with credentials. Assess and test CSRF, cookie exposure, and trusted origins in a separate security ticket. These concerns were not fixed by RPF-001B.

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
