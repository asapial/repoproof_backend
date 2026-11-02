# RepoProof API inventory — November 2, 2026

Observed sources: src/appFactory.ts, src/index.ts, src/safeMvp/{router,drafts}.ts,
src/contracts/{v1,safeMvp,requestDraft}.ts and pinned Better Auth 1.7.14 routes.
Express owns the API; Next.js is a same-origin proxy/client. All v1 failures use
the strict errorResponseSchema envelope with requestId. Internal Sandbox/Meta/
guest helpers are unregistered; do not document or expose them as public APIs.

## Implemented application surface

| Method / exact path | Input / output | Authentication / authorization | Errors / rate / frontend / evidence |
| --- | --- | --- | --- |
| GET / | none / service status, environment, uptime/time | Public | Legacy status, not versioned business data; no frontend dependency. |
| GET /healthz | none / {status:ok} | Public | no-store; liveness only; health.test.ts. |
| GET /readyz | none / {status:ready or unavailable} | Public | Bounded DB probe, 503 on timeout/failure; no-store; health.test.ts. |
| GET /api/v1/repositories | none / safeFixtureCatalogSchema | Session; public curated allowlist | 401/500; no-store; SafeMvp catalog(); router.test.ts and historical real SQL/browser. |
| GET /api/v1/repositories/repoproof-backend/issues | no query / issuePreviewSchema | Session; only owned approved repository/issue; pinned commit/tree | 400/401/403/404/429/503/500; PostgreSQL owner/global limits; two bounded GitHub GETs; no-store. RPF-012I real local auth/SQL and live public GitHub metadata passed, including exported Function bundle and limited-role checks. Frontend consumer pending RPF-013I. |
| GET /api/v1/request-draft | none / requestDraftResponseSchema | Session owner resolved server-side | 401/500; no-store; SafeMvp draft(); drafts.test.ts and real two-user SQL/browser. |
| PUT /api/v1/request-draft | requestDraftSchema / requestDraftResponseSchema | Session owner, approved exact fixture; CSRF Origin | 400/401/403/404/500; one saved draft per user; SafeMvp saveDraft(); SQL constraints and owner tests. |
| DELETE /api/v1/request-draft | no body / {draft:null} | Session owner; CSRF Origin | 401/403/500; idempotent; SafeMvp deleteDraft(); two-user SQL/browser. |
| POST /api/v1/runs | createRunRequestSchema / errorResponseSchema | Session; exact approved fixture; CSRF Origin | 400/401/403/404; valid request always **503 RUNNER_UNAVAILABLE**. Zero run/job/evidence/approval creation. SafeMvp requestRun(); real HTTP/browser and router.test.ts. |
| other /api/v1 paths | none / errorResponseSchema | No business operation | 404 NOT_FOUND. Authenticated unknown run/report/artifact paths do not become working endpoints. |

## Authentication framework surface

Mounted at /api/auth/* by toNodeHandler(auth). Framework errors are intentionally
separate from the v1 envelope. Better Auth validates its native bodies and
sessions; shared PostgreSQL/HMAC rate storage defaults to 120/minute, email
sign-in 5/minute and sign-up 10/15 minutes, with a shared 600/minute store ceiling.
Bodies are bounded to 16 KiB/5 seconds; trusted IP, origin and CSRF guards apply.
All browser clients send credentials and no-store and never store session tokens.

| Method / suffix under /api/auth | Availability and ownership | Current frontend consumer / verification |
| --- | --- | --- |
| POST /sign-up/email | Enabled; {name,email,password}; creates own account/session | SafeMvp registration; actual SQL/browser/security tests. |
| POST /sign-in/email | Enabled; {email,password}; own account/session | SafeMvp sign-in; wrong-password/throttle/session tests. |
| GET /get-session | Current authoritative DB session or null; legacy cache cleared | SafeMvp loader; real SQL/browser/recovery/revocation. POST requires deferSessionRefresh and is not enabled. |
| POST /sign-out | Current session | SafeMvp sign-out; actual SQL/browser. |
| POST /update-user | Native current-user name/image update | No UI yet; revoked signed-cache denial proven in real SQL; successful profile UI remains pending. |
| POST /change-password | Native authenticated current-password change | No UI yet; real restricted-role SQL verifies wrong-password denial, replacement password and other-device revocation. |
| GET /list-sessions | Native own sessions | No UI consumer; not independently product-tested yet. |
| POST /revoke-session, /revoke-other-sessions | Native own-session revocation | No UI yet; real SQL verifies other-device revocation, cross-user denial, stale-cache replay and current/unrelated-user controls. |
| POST /revoke-sessions | Native all-own-session revocation | No UI; separate product acceptance remains pending. |
| POST /verify-password, /update-session | Framework native guards/options | No product consumer; do not present as completed product functionality. |
| GET /list-accounts, /account-info | Framework native own-account guards | No product consumer; no public tokens returned by an app-owned wrapper. |
| POST /sign-in/social, /link-social, /unlink-account, /get-access-token, /refresh-token; GET or POST /callback/:id | Framework routes present; no socialProviders configured | Google env validation alone does not enable OAuth. No connected-provider claim or UI. |
| POST /request-password-reset, /reset-password, /send-verification-email; GET /reset-password/:token, /verify-email | Require configured email callbacks/verification options | Not configured; no working reset/verification advertised. |
| POST /change-email, /delete-user; GET /delete-user/callback | Require explicitly enabled features and framework freshness/verification | Not enabled; no destructive account control advertised. |
| GET /ok, /error | Native framework health/error | No frontend dependency; not application readiness or provider evidence. |

The framework entries above are an installed-code inventory, not claims that
every conditional route works or was live tested. Account UI tickets must inspect
the exact request/response/guards and test the configured behavior before use.
RPF-SEC-007 disables session cookie caching globally; PostgreSQL revocation and
server expiry apply on every lookup, including cookies issued by the older
five-minute cache policy. The wire contracts and valid sessions remain compatible.

## Target paths still unimplemented

GET /api/v1/health (existing health paths above differ),
GET /api/v1/runs,
GET /api/v1/runs/:id, POST /api/v1/runs/:id/approve,
POST /api/v1/runs/:id/cancel, GET /api/v1/runs/:id/events,
GET /api/v1/runs/:id/report, GET /api/v1/runs/:id/report.md,
GET /api/v1/runs/:id/artifacts/:artifactId.

Existing v1 schemas for creation/plan/events/report are proposed wire contracts,
not a running backend. Every new route needs exact validation, authentication,
ownership/error/rate tests and a separately verified frontend consumer. Run,
report and artifact APIs retain their original trust/runner dependencies.
OpenAPI should describe shipped supported surfaces without exposing privileged
runner controls, secrets, private storage keys or falsely implemented paths.
The shipped issue preview is described in issue-preview.openapi.json (OpenAPI
3.1, one operation; schemas exported from the actual strict Zod contracts).
