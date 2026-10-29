# RepoProof - Canonical Two-Repository Task Board

**Canonical tracked location:** `repoproof_backend/docs/TASK_BOARD.md`. **Owner:** backend Git repository. **Architecture:** two existing, independent Git repositories, NOT a monorepo.

**Evidence policy:** `TODO` here means *not yet independently verified against existing code*, not necessarily unimplemented. Before implementing, inspect actual source/tests and existing user changes. Mark DONE only with real observed test evidence and relevant code SHA(s). Never fabricate success based on old docs or generated files. Parent `docs/TASK_BOARD.md` (if any) is historical, noncanonical.

Status options: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`. Edit one ticket at a time and keep previous evidence.

## Setup and foundation (two-repo replacement for old RPF-001)

| Ticket | Repo | Status | Depends | Acceptance evidence / meaning | Code SHA / checks |
| --- | --- | --- | --- | --- | --- |
| RPF-001A | frontend | DONE | - | Verify or establish quality gates for EXISTING frontend: TypeScript, lint, tests and build using real scripts; preserve current app | Frontend e9a4a6e267b3e2f3c4b3dcaa881de00f2414ed86; isolated copies with existing dependencies: npm test -- --maxWorkers=1 (6 passed), npm run lint, npm run typecheck, and npm run build passed. Next.js ESLint plugin warning remains; contract tests do not establish live UI/API integration. One-time approved exception: tracking-only commit; no frontend code change required. |
| RPF-001B | backend | DONE | - | Existing backend quality gates verified; JWT negative tests added | 05fd51f297c69cbb1659c28c2dd64df2f00d0c81; npm run lint and typecheck passed; npm test -- --maxWorkers=1: 9 passed (7 in untracked RPF-001C tests, 2 committed JWT tests); isolated copy excluding RPF-001C: lint, typecheck, 2 JWT tests and build passed; git diff --check passed |
| RPF-001C-BE | backend | DONE | RPF-001B | Existing backend-owned v1 DTO schemas and runtime schema validation for the documented contract; no live routes or authorization claim | Backend `97a2c52ba6827ccd0f25a06f1933d3865f9bc44c`; contract tests 14 passed; full suite 16 passed at reconciliation. |
| RPF-001C-FE | frontend | DONE | RPF-001C-BE | Existing frontend snapshot and typed v1 contract validation match the pinned backend contract; no live UI/API claim | Frontend `e9a4a6e267b3e2f3c4b3dcaa881de00f2414ed86`; contract snapshot byte comparison and 6 tests passed at reconciliation. |
| RPF-001C | backend | IN_PROGRESS | RPF-001C-BE, RPF-001C-FE, RPF-012A, RPF-012B | Parent: live frontend/backend request, response, authorization and error-envelope compatibility after actual run and report routes exist | Contract evidence remains above; the backend error envelope was reused in RPF-012S, while the separate frontend parser remains uncommitted. Live integration remains unverified. |

### RPF-001C reconciliation evidence

- RPF-001C-BE and RPF-001C-FE cover only the already verified contract snapshots. RPF-001C remains the live-integration parent and is not complete. RPF-012A depends on the backend contract, not the parent, avoiding a dependency cycle.
- SAFE_MVP_NO_RUNNER holds RPF-006A; the DEFERRED status records the explicit suspension. Runner-dependent tickets retain their original prerequisites. RPF-012S does not replace RPF-012A or relax runner, approval or verdict requirements.

- Rechecked the frontend commit-pinned byte comparison against both backend contract files and reran the backend and frontend tests above; all passed with no skips. The checks validate proposed DTOs with sample data, not live HTTP integration.
- The backend commit records ESLint, typecheck, isolated production build, diff checks, and staged secret review. The frontend commit records the same gates and its compatibility check. These are commit-time results; builds and lint were not rerun during this documentation reconciliation.
- The full `/api/v1` business run lifecycle is not implemented; RPF-012S only rejects run requests when the runner is unavailable. Actual frontend-to-backend request, response, authorization, and error-envelope compatibility remains unverified until the lifecycle endpoints and consumers exist. Legacy authentication errors remain separate from the v1 envelope. RPF-012S adds a limited curated catalog; issue lists, cancellation responses, and history still lack finalized DTO shapes. Keep RPF-001C IN_PROGRESS pending integration proof; later run API work is tracked by RPF-012A/RPF-012B.
- At RPF-001C reconciliation, `RPF-SEC-001` was a separate pending P0 security issue. Contract checks did not test CSRF, cookie, or CORS concerns; see the security ticket below for its current status.

## Existing RepoProof v2 backlog (preserve original RPF ticket meaning)

| Ticket | Repo | Status | Depends | Acceptance evidence / meaning | Code SHA / checks |
| --- | --- | --- | --- | --- | --- |
| RPF-010A | backend | DONE | RPF-001B | Pure verdict policy and negative tests reject false VERIFIED results | b8052796c5db8610368d74e9928938ed9b5eb97d; policy tests 10 passed, full suite 30 passed; ESLint, typecheck, isolated build and diff checks passed. Synthetic evidence only; trusted runner integration remains RPF-010B. |
| RPF-002 | backend | DONE | RPF-001B | Owned pinned JS/TS fixture, real failing issue test, known manual fix | Public baseline `1066351c5b07bed024775a16af9151048a9316b2`; issue https://github.com/asapial/repoproof_backend/issues/1. Clean checkout: Node TAP issue assertion failed 120 != 80 (1 test, exit 1); regressions 2 passed. Manual reference fix: unchanged issue 1 and regressions 2 passed. Frozen hashes verified. Ticket-scoped TAP exception accepted. Public-base and candidate TypeScript checks had the same 14 pre-existing diagnostics; complete public-base typecheck did not pass. Tracking-branch tests 30 passed; lint, typecheck, isolated build and diff checks passed. Historical local baseline `f56bcb6d6dbae99b0805ac8b6c7162e6994447bc`, evidence `e3921db059ae3740a76153b06cbfceabf50928b4`. |
| RPF-003 | backend | DONE | RPF-001B | Real Meta API adapter smoke when credentials/budget approved; structured errors and secret safety | Live Meta `muse-spark-1.3`: HTTP 200, structured output validated, finish `stop`, one request, zero retries, 3021 ms; 11 input, 119 output tokens including 103 reasoning, 130 total. Estimated standard token cost $0.0005195; provider spend alerts are not hard caps. Prior 32-token attempt truncated; earlier failure cause unknown. Offline: 36 adapter tests, 66 total tests, lint, typecheck, isolated build and diff check passed. Post-smoke secret-redaction hardening covered by regression test. |
| RPF-004 | backend | IN_PROGRESS | RPF-002 | Separate isolated allowlisted fixture runner; fixed commands, timeouts, cleanup | Offline fixture, authentication, evidence and lifecycle checks: 47 tests; full suite 113 passed; lint, typecheck and isolated application bundle passed. Durable replay storage, deployed authentication, trusted provenance, dedicated runner VM, symlink containment and real isolation remain unimplemented or unverified; no runner execution evidence. Full build blocked by existing generated Prisma edits. |
| RPF-005 | backend | TODO | RPF-004 | Structured test results parse executed/skipped/failure and malformed JSON | - |
| RPF-006A | backend | DEFERRED | RPF-003 | Meta issue triage with schema validation and read limits | - |
| RPF-006B | backend | TODO | RPF-004, RPF-005, RPF-006A | Test generated and frozen before patch; bytes/hash verified | - |
| RPF-007 | backend | TODO | RPF-006B | Failing baseline assertion or honest NO_REPRO, with zero patch on NO_REPRO | - |
| RPF-008 | backend | TODO | RPF-003, RPF-007 | Bounded source-only patch with path, test and lockfile protection | - |
| RPF-009 | backend | TODO | RPF-008 | Independent retest of frozen reproducer and regressions with hashes | - |
| RPF-010B | backend | TODO | RPF-010A, RPF-009 | Real artifacts drive four deterministic verdicts, never model claim | - |
| RPF-011A | backend | DONE | RPF-001B | Persistence schema/migrations for immutable run evidence as supported by actual stack | Disposable PostgreSQL 16: Prisma migrate deploy/status and repeat deploy passed; 24 negative constraint tests and synthetic positive cases passed. Prisma validate/generate, 66 tests, lint, typecheck, build and diff checks passed. Artifact-byte verification, authenticated provenance, verdict integration and retention remain separate work. |
| RPF-011B | backend | TODO | RPF-011A, RPF-010B | Durable orchestrator and job lifecycle tests | - |
| RPF-012S | backend | DONE | RPF-001C-BE | Runner-free safe MVP: authenticated allowlisted fixture catalog and fail-closed run requests returning RUNNER_UNAVAILABLE; no run, queue, execution or verdict | This commit: 71 tests, lint, typecheck, isolated build, disposable PostgreSQL-backed session/HTTP integration and diff checks passed. No runner or live frontend integration exercised. |
| RPF-012T | backend | DONE | RPF-012S | Export a strict backend-owned curated catalog response schema for frontend consumption; preserve fail-closed API behavior | This commit: 73 tests, lint, typecheck, isolated build, disposable PostgreSQL-backed HTTP regression and diff checks passed. |
| RPF-012A | backend | TODO | RPF-011B, RPF-001C-BE | Read-only issue selection, create/approve/cancel APIs with auth and contracts | - |
| RPF-012B | backend | TODO | RPF-012A | Authenticated events/reports/artifacts APIs with integrity checks | - |
| RPF-013S | frontend | TODO | RPF-001A, RPF-001C-FE, RPF-012T | Authenticated safe MVP UI consuming the real curated catalog and displaying RUNNER_UNAVAILABLE truthfully; no execution, run or verdict claims | See `docs/SAFE_MVP_SCOPE.md`; not implemented. |
| RPF-013A | frontend | TODO | RPF-001A, RPF-001C, RPF-012A | Existing UI extended with issue selection and approval; real APIs, loading/errors, a11y | - |
| RPF-013B | frontend | TODO | RPF-013A, RPF-012B | Live evidence timeline, diff and honest four-verdict report from actual API | - |
| RPF-014 | cross-repo | TODO | RPF-010B, RPF-013B | False-fix and no-repro scenarios; SPLIT into -BE/-FE before code work | - |
| RPF-015 | cross-repo | TODO | RPF-014 | Security + fresh checkout E2E; SPLIT into scoped tickets before code work | - |
| RPF-016 | cross-repo | TODO | RPF-015 | Demo/release docs, authentic model evidence; SPLIT or explicitly own tracked artifacts | - |

## Pending security issue

- **RPF-SEC-001 — P0 DONE: authentication and cookie security.** Better Auth CSRF and origin checks are enabled; cookies are HttpOnly with environment-appropriate Secure/SameSite/Path attributes; CORS uses explicit configured origins. `fbf59b76c830c68306507bb1e28e3801c3b8c2b9`: full suite 20 passed; Prisma-backed registration, login, failed login, session, logout, CSRF, both cookie modes and CORS passed against the confirmed disposable test database; synthetic data removed. Migration status, ESLint, typecheck, isolated production build and diff checks passed. Deployed browser, OAuth and future frontend proxy integration remain unverified; see `docs/AUTH_SECURITY.md`.

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
