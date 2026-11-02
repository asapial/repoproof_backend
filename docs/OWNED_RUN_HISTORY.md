# Owned run history — RPF-HISTORY-001BE

GET /api/v1/runs returns the current authenticated user's supported persisted run
records, summary counts and bounded cursor pagination. This splits read-only
history from the blocked execution-creation ticket. POST /runs still returns
503 RUNNER_UNAVAILABLE and creates no run, job, approval, report or artifact.

## Contract and authorization

runHistory.ts owns the strict response and query DTOs. Page size defaults to 10
and is limited to 1–25. Rows sort by createdAt descending, then ASCII id
descending; a canonical base64url JSON cursor preserves both fields. A cursor
grants no authority: every page still uses the session-resolved owner. Extra,
ambiguous, repeated and malformed query parameters return safe 400 errors.

Only the owned pinned discount-bug repository/issue is supported. Null owners,
other users, revoked/unapproved fixtures and unsupported pins are excluded.
Counts reflect the same eligible records and statement snapshot as the page.
They include stored lifecycle states, repository count and distinct submitted
issues. A stored COMPLETED state is not a verification verdict. No verdict,
report, raw evidence, source, plan, lease, storage key, credential or model field
is returned. All responses use no-store; shared PostgreSQL limits bound each
owner to 60 requests/minute and the history surface to 300/minute, subject to
the existing shared auth-store cap. Unavailable quota storage denies access.

The read-only SECURITY DEFINER function has a fixed trusted search path, bounded
parameters, fixed curated predicates and PUBLIC execution revoked. The trusted
backend passes the current session user ID; this is application authorization,
not per-end-user database RLS. Runtime receives only EXECUTE on the projection.
Its raw Run/report/artifact table privileges remain denied. Migrate first, then
apply deploy/runtime-grants.sql as the owner with explicit database/role inputs.
Missing migration, grant, malformed results or SQL failures return safe 503;
they never become an empty success. Existing five frontend contracts are intact.

## Actual validation

Node 24.22.2: 23 focused and 761 full tests across 51 files; lint, source and
integration types, normal/Function builds, clean lockfile install, lint-toolchain
checks and full/production audits with zero findings pass. Initial test-parameter
typing and external OpenAPI-generator path failures were corrected and retained
in evidence. OpenAPI 3.1 is generated from the actual strict Zod response/error
schemas; cross-field invariants also remain enforced by runtime validation.

All 11 migrations deploy into a new owned local rpf_history_disposable database,
status succeeds and repeat deployment has no pending migration. Restricted-role
real HTTP source and exported Function checks cover empty accounts, two owners,
null owners, seven-state counts, tied-date pagination without duplicates,
cross-owner cursors, query injection, hidden fixtures/pins, private-field
exclusion, PUBLIC ACLs, raw-evidence and role-escalation denial, invalid SQL
parameters and the actual shared rate limit. POST /runs remains unavailable.
Counts are unchanged after synthetic setup; no code was executed from a fixture.

History test rows and accounts are explicitly synthetic, retained only in that
disposable database. They are not genuine execution or product report evidence.
The existing product database and other databases remain unchanged by this gate.
External/GitHub/Meta/Sandbox calls and fixture executions are zero.

Command/exit/log-hash records: output/full-product-2026-11-02/evidence/history-*.
Frontend dashboard/history integration is a separate next ticket. RPF-004 stays
IN_PROGRESS, RPF-006A stays DEFERRED, and full-product acceptance remains pending.
