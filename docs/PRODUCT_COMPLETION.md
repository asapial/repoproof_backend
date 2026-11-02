# Full-product completion ledger

## Resumed full-product mission — November 2, 2026

The current goal authorizes sequential reviewed local feature commits and a
hard $0 cash limit. Bounded Meta/Sandbox smoke tests are conditional on verified
actual free entitlement/quota and the stated harmless scope. No paid fallback,
upgrade, billing activation, deployment, push, production write or arbitrary
repository execution is authorized. RPF-006A remains DEFERRED; RPF-004 remains
IN_PROGRESS. The earlier starting-state and evidence sections below are history.

- Reporter recovery was already committed at 3170d85; implementation was reused.
  Fresh lockfile npm ci restored missing Babel dependencies without a source or
  lockfile change. Node24 68 reporter tests, real numeric pass/fail tests, three
  standalone bundle hash checks, instrumentation types and the current 738-test
  full engine/normal/Function quality gates pass with zero audits. Trusted
  numeric self-tests are not fixture execution or authenticated runner evidence.
- Release session-revocation port: 92bbb426dc3abe23ebb1708c54cf4e361b431f7a,
  predeploy-backend / feature/rpf-sec-007-release. Three frozen baseline failures,
  138 full tests and real restricted-role source/Function checks pass. Original
  release branch at 17042919 remains intact; the actual cooldown was honored.
- Existing account frontend reused and committed: 10395a358b625ba5dc9dcf9b4ecdff3c6a0caf82;
  separate backend tracking f871c46dfda4a90747a5dfd8a939717c370ab887. Fresh 69
  frontend tests, quality gates and actual production proxy/SQL browser plus
  responsive/visual review pass. Original .gitignore edit remains preserved.
- New candidates: full-product-backend / feature/full-product-backend starts at
  the tested engine descendant of the original release base; full-product-frontend
  / feature/full-product-frontend starts at the account commit. No branches were
  merged or overwritten. Contracts still pin 397d84d until the next consumer.
- RPF-HISTORY-001BE: this commit adds actual owner-scoped stored history/counts.
  Node24 23 focused/761 full tests and all local quality/Function/migration gates
  pass. Real source/Function SQL tests use a separate synthetic-record database;
  no real execution or verdict is inferred. See OWNED_RUN_HISTORY.md. Dashboard
  and premium SVG identity/UI are the next independent frontend ticket.

The append-only local ledger, exact starting dirty hashes and command evidence
live in output/full-product-2026-11-02. Preserve all historical checkpoints and
manifests. Full-product status remains PARTIALLY_COMPLETE_WITH_BLOCKERS.

## Scope and authoritative starting state — November 2, 2026

Objective: complete the integrated RepoProof product described by the existing
PRD, flows, architecture and evidence rules. Local engineering may continue
sequentially. $0 is a hard spending limit. No push, merge, deploy, cloud
provisioning, billable inference, live Sandbox or production writes are approved.
RPF-006A remains DEFERRED until explicit resumption; RPF-004 remains IN_PROGRESS.

| Checkout | Verified branch / starting HEAD | Preservation |
| --- | --- | --- |
| meta-engine-backend | feature/meta-engine-offline / ebbe24c3eed9c03d8a10c081c597a3bb18aff8c9 | All seven initial dirty path groups belonged to unfinished RPF-REPORTER-002; reused and completed below. |
| predeploy-backend | feature/predeployment-backend / 17042919eb1c4a4b6b73e56ce4b2562a95e67062 | Clean, separate release candidate; not integrated with engine branch. |
| predeploy-frontend | feature/predeployment-frontend / f9519dfc719a7949ef4625038dcc62e4dc35c2cd | Existing unstaged duplicate .vercel ignore entry preserved. |
| repoproof_backend | feat/rpf-004-isolated-runner / 4928aaf1e3672b9ebdae1b7dd97d6105bba16ce4 | Original dirty runner, board, generated Prisma and other files remain untouched. |

Backend board changes are made in its Git repository's active engine worktree;
the historical primary checkout's dirty copy is not overwritten. Existing release
manifests and all worktree registrations remain preserved. No feature-branch
commit is represented as merged into a release candidate.

References inspected: parent prd.md, appflow.md, trd.md, schema.md,
MVP_API_REQUIREMENTS.md, TWO_REPO_ARCHITECTURE_OVERRIDE.md; actual backend/frontend
source, canonical board/history, deployment package and engine checkpoints.
Parent docs/plan.md and docs/ui spec.md do not exist. Use the supplied flows and
current visual language; do not invent a missing design specification. Legacy
monorepo and Next.js API proposals are superseded by the two-repo Express contract.
The owned Node test exception and current immutable fixture/runtime policies
supersede conceptual Vitest starter examples without relaxing evidence gates.

## Requirements-to-implementation matrix

COMPLETE means verified within the explicitly stated local scope. It does not
mean deployed or live-provider verified. PARTIAL includes remaining local work;
BLOCKED identifies an unavailable required external decision or trust boundary.
NOT_APPLICABLE records explicitly later/conditional product scope.

| Requirement | State | Backend / persistence | Actual frontend | Tests / security / integration evidence and remaining work |
| --- | --- | --- | --- | --- |
| Public landing and scope disclosure | PARTIAL | No API required | / and /runs/new now share real Home/New verification navigation | Fresh real browser and desktop/tablet/mobile screenshots pass. Remaining app pages are still missing. Primary old e9a4a6e checkout renders only a title and two paragraphs; do not confuse it with the candidate. |
| Registration, email sign-in, session, logout | COMPLETE (local core) | Better Auth + PostgreSQL user/session/account; shared throttling, CSRF/origin and HttpOnly cookies | Working same-page forms | Historical real PostgreSQL/proxy browser tests. Fresh product validation and deployed HTTPS remain required. |
| Account/profile and session management | PARTIAL | Native Better Auth update-user/change-password/session APIs exist; account deletion/email change are not enabled | No account/settings view | Add real consumers, negative auth/origin/session tests and browser recovery. No new parallel auth system. |
| Google authentication when enabled | MISSING | Environment validates GOOGLE_* but auth has no socialProviders registration | No provider button | Local wiring/disabled state can be implemented. Actual callback origins and interactive provider verification remain external. |
| FR-01 / F-01 approved repository selection | PARTIAL | Authenticated curated catalog/draft and owned live issue preview persist/read | /runs/new inspects actual title/body/commit, refreshes/cancels and saves draft | Fresh real PostgreSQL/proxy/browser/GitHub metadata proof. No arbitrary repos; run creation/snapshot persistence remains gated. |
| GitHub issue/source validation | PARTIAL | OwnedGitHubIntake pins commit/tree/blob bytes; RPF-012I registers bounded authenticated issue/commit preview | RPF-013I consumes real issue/pin with safe plain-text rendering | Live metadata checks pass through local auth/SQL/Function/browser. Full source intake remains separately gated and unregistered; preview grants no source/execution authority. |
| Saved request drafts | COMPLETE (local scope) | One per authenticated owner; strict schemas/constraints | Save/restore/delete work | Historical real two-user PostgreSQL and browser checks; no run or evidence rows are created. |
| FR-02 / F-02 issue triage | BLOCKED | Typed Meta ANALYZE task exists; no production triage lifecycle | No plan view | RPF-006A explicitly DEFERRED. Do not implement/resume it through a renamed ticket. |
| FR-08 / F-03 human approval | PARTIAL | Target DTO/schema exists; no live create/approve route or approval orchestration | No approval page | Full parent prerequisites remain. Never queue execution from UI or model output. |
| FR-03 / F-04 generated and frozen test | PARTIAL | AST admission, private exact bytes/hashes, durable frozen packages, protected source edits | No test source/status view | Local synthetic/SQL preparation tested. Live generation/discovery and trusted runtime remain blocked. |
| FR-04 / F-05 baseline reproduction | BLOCKED | Receipt protocol/counter/pure policy prepared; no trusted baseline | No before/after display | RPF-004 and RPF-006A prerequisites unmet. Native numeric instrumentation self-tests are not fixture reproduction. |
| FR-05 / F-06 source-only patch | PARTIAL | Typed bounded proposals, admissibility, immutable snapshots and no-follow guest preparation | No patch details | Source-only policy tested offline. Live patching remains downstream of genuinely reproduced baseline. |
| FR-06 / F-07 identical-test independent retest | BLOCKED | Pure policy plus synthetic pipeline; no authenticated execution adapter | No deterministic report view | No live isolation/provenance proof. Synthetic receipts always authentic:false; production cannot claim VERIFIED. |
| FR-07 / F-08 reports and artifacts | PARTIAL | Immutable SQL evidence schema and target report DTO; no authorized retrieval/export/byte store integration | No report route/diff/downloads | SQL constraints tested historically. Must authenticate owner, verify bytes/provenance and escape untrusted content before exposing evidence. |
| Run history, progress, cancellation, retry | PARTIAL | PostgreSQL lease/replay/quarantine/stage foundations; no public lifecycle/read APIs | No history/timeline | Existing durable SQL tests do not prove the product job workflow. Read-only owner history can be split independently; no fabricated runs. |
| FR-09 / F-09 three genuine demos | BLOCKED | One owned fixture; synthetic cases cover false fix/no repro | No demo page | Need real approved end-to-end cases and recorded artifacts. Synthetic cases must never become a production dashboard. |
| Meta authentication/catalog/structured tasks | PARTIAL | Meta adapter, catalog-bound tasks, abort/deadlines, accounting; key present locally | No provider status or analysis | Historical paid smoke is not current permission. No provider-enforced no-charge entitlement/reservation controller is proven. |
| Meta durable usage/replay/idempotency | PARTIAL | Immutable attempt/outcome accounting and quarantined effects | No usage display | Real local PostgreSQL checks exist. Actual provider dispatch and zero-charge reservation remain unavailable. |
| RPF-004 isolated execution | BLOCKED | Disabled Vercel SDK/admin smoke, packets and resource/guest preparations | Truthful RUNNER_UNAVAILABLE | No real image/network/IPv4/IPv6/metadata/FS/cross-VM/resource/cleanup/provenance verification. Separate live authorization required. |
| Durable orchestration and recovery | PARTIAL | PostgreSQL CAS/leases/replay/freeze/journal/reconciliation foundations | No lifecycle consumer | No Function-compatible live stage executor; uncertain effects remain quarantined. Prove lease/SQL/Function/provider timing before activation. |
| Neon migrations/runtime/backup | PARTIAL | Ten versioned migrations, role/grant and backup procedures; real local SQL evidence | Auth/drafts use real local database in integration | Configured Neon URL is not a proven least-privilege/TLS/free-plan target. No owner DIRECT_URL supplied; no cloud writes approved. |
| Frontend/backend security integration | PARTIAL | Strict DTOs, same-origin proxy, no-store, origin/CSRF, shared auth limits | Session-expiry/deadline recovery exists | Historical real proxy browser plus fault-injection checks. New workflow needs fresh owner/malformed/timeout/denied integration checks. |
| Responsive/accessibility/navigation | PARTIAL | N/A | Current page has labels/loading/empty/error states and mobile CSS | Required page set/navigation missing; verify rendered desktop/tablet/mobile and keyboard behavior after UI changes. |
| API documentation and inventory | PARTIAL | Existing schema snapshots; inventory added in API_INVENTORY.md | Current consumers documented | Add strict contracts for each new surface and safe OpenAPI where useful. Unimplemented paths remain explicit. |
| Operational health/logging/quotas | PARTIAL | /healthz, /readyz, redacted auth errors, bounded pools, no secret logs | No settings/status page | Local tests exist. Deployed trusted-IP, shared quotas, monitoring and live runner health remain unverified. |
| Vercel frontend/backend readiness | PARTIAL | Express export/Prisma generation, Node24 config, migration/rollback package | Same-origin server rewrite uses REPOPROOF_API_ORIGIN | Historical local build/Function/proxy checks. Actual eligible free account, exact origins, deployed tracing/HTTPS and owner approval absent. |
| Product acceptance, release, rollback | PARTIAL | Prior SAFE release manifest preserved; engine candidate separate | Prior preview candidate separate | Fresh full-product browser/API/DB tests and coherent candidates remain required. No full-product release or E2E claim. |
| F-10 GitHub App, F-11 write publishing, F-12 arbitrary repos | NOT_APPLICABLE (approved curated P0) | Explicit post-MVP/conditional scope | No working controls advertised | Do not add GitHub writes, private-repo access, arbitrary execution, billing, teams or infrastructure. |

## Completed tickets and exact local commits

- RPF-REPORTER-002: **3170d85a411eafb11036fb1e1aa18aa1b4c970fd**,
  feature/meta-engine-offline. 68 focused tests, 709 full tests in 45 files;
  Node24 native numeric pass/fail self-tests; source/instrumentation types, lint,
  build, toolchain and zero full/production audits. Three SHA-256 checked
  standalone bundles pass both primitive cases. Sixteen reviewed files; thirteen
  protected fixture/task/policy hashes unchanged. No fixture/provider execution.
- RPF-PRODUCT-001: **7a6f00d8c5dadf19157640cb3e8b7dadc6bcef6d**,
  source/requirements audit and complete observed API inventory; no runtime claim.
- RPF-012I: this commit. Authenticated read-only owned issue/commit preview,
  strict DTO/OpenAPI, shared PostgreSQL quota, fixed credential-free GitHub reads
  and safe errors/cancellation. Node24 52 focused/735 full tests in 48 files,
  lint, source/integration types, normal/Function builds, toolchain and zero
  full/production audits passed. Fresh owned local DB deployed/status/repeated
  all ten migrations. Live source and exported Function metadata checks passed;
  final accepted Function used a limited runtime role, independently observed
  unchanged Run/report/artifact counts and real five-of-eight SQL admission.
  Six total public GitHub GETs across the three accepted metadata checks;
  zero source/fixture execution, Meta or Sandbox calls. One intermediate
  integration-only TypeScript annotation failure is retained and fixed; final
  integration types/lint/live Function passed. Next: frontend RPF-013I.
- Earlier engine work remains in existing history and checkpoint evidence.
  Its DONE labels describe preparation only; none completes a blocked parent.
- RPF-013I frontend: **06f1c5b448ab9a37fce75d15cdd6db3048622bb5**,
  feature/rpf-013i-issue-workflow. Board-only backend tracking:
  **3d5f3e4eac7934a5f8e3f12e55f72b97d07903d1**. Seventeen focused/49 full
  frontend tests, five-file contract checks, lint/types/build/clean install and
  zero audits passed. Real restricted-PostgreSQL proxy browser + four public
  metadata GETs, four viewports/keyboard/draft/quota/logout and separate fault
  cases passed. Desktop/320 px screenshots reviewed; product evidence rows zero.
- RPF-SEC-007: this commit. Disable signed session caching so PostgreSQL
  revocation/expiry applies immediately, including legacy cookies. Three frozen
  baseline assertion failures now pass unchanged. Fourteen focused/738 full
  tests, complete quality/Function/integration gates and real restricted-role
  PostgreSQL revocation/password/user-isolation checks pass; source and Function
  paths. Browser regression passes; zero external/fixture/Meta/Sandbox calls.
  See SESSION_REVOCATION.md and immutable sec007-* command/hash evidence.

## Current integration/status ledger

| Area | Actual status |
| --- | --- |
| Frontend | 06f1c5b / feature/rpf-013i-issue-workflow, descendant of f9519df; functional auth/catalog/draft/live issue inspector. Other main pages remain missing. Original .gitignore edit preserved. |
| Backend | Engine branch includes release baseline, offline foundations, reporter and live read-only issue preview; execution remains unavailable. |
| Database | Owned local PostgreSQL rpf-predeploy-20261101 is live. New rpf_product_disposable has ten migrations and a limited rpf_product_runtime role; other databases/immutable synthetic evidence preserved. No cloud validation. |
| Configuration | MODEL_API_KEY, Neon DATABASE_URL and optional Google credentials exist by name. Active files lack BETTER_AUTH_SECRET, BETTER_AUTH_URL and FRONTEND_URL. Never print/copy secret values into evidence. |
| Meta | Live no-charge entitlement not established; default denial remains. |
| Sandbox/security | Zero new live calls/VMs; RPF-004 unverified; independent observer and real isolation acceptance missing. |
| Real E2E | Fresh production proxy/browser, local restricted SQL and live public issue metadata pass. Session-revocation security and synthetic UI fault gates pass. Full issue-to-verdict provider/runner E2E remains missing. |
| Deployment | Local package exists, no deploy/provisioning/push/merge authorized. Credentials do not configure Vercel projects automatically. |

## Dependency-ready sequence and blockers

1. RPF-012I (completed locally): split read-only owned issue preview from RPF-012A, depending only on
   RPF-001C-BE and RPF-INTAKE-002. Authenticate, pin/validate input, bound GitHub
   GETs/deadlines/global rate, exclude PRs and return safe documented DTOs. This
   grants no run creation, triage, approval, execution or verdict authority.
2. RPF-013I (completed locally): frontend issue-selection/inspection route consuming that actual API;
   preserve current auth/drafts and unavailable execution. Separate frontend
   code and backend tracking commits, actual browser/API/database verification.
3. RPF-ACC-001FE (current next): account/profile/password and revoke-other-session
   controls using the actual native authenticated endpoints, after RPF-SEC-007.
   Verify real own-user behavior, safe errors, confirmation of session changes,
   expiry and responsive keyboard/browser flows. No destructive account deletion.
4. Independently split owner-scoped read-only history from execution creation;
   add account/session/settings/navigation using actual authorized records.
   Keep parent run/report prerequisites and missing live evidence explicit.
5. Resume the exact next eligible implementation after each reviewed commit;
   update this ledger, API inventory and canonical board with real evidence.

External decisions to consolidate when the concrete local candidates are ready:
RPF-006A resumption; current Meta account/model read access and enforceable
no-charge entitlement plus explicit inference scope; named eligible free
Vercel/Neon resources/origins and deploy/migration approval; separately scoped
owned Sandbox smoke/negative tests, independent observer and cross-VM quota.
Approval of any one item never implies the others. Continue independent local
work while those decisions remain unavailable.

Final product state remains **PARTIALLY_COMPLETE_WITH_BLOCKERS**. Do not claim
LOCAL_ENGINEERING_COMPLETE_LIVE_VERIFICATION_PENDING until all local gaps close,
or FULL_PRODUCT_VERIFIED before real approved acceptance evidence exists.
