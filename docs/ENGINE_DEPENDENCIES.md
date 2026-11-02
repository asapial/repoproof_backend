# Verification engine dependency reconciliation — RPF-DEP-001

Reconciled November 2, 2026 against current canonical board and actual source.
Release bases remain backend 17042919eb1c4a4b6b73e56ce4b2562a95e67062 and frontend
f9519dfc719a7949ef4625038dcc62e4dc35c2cd. Engine work is on the separate
feature/meta-engine-offline branch/worktree, not merged into either release.
Historical dirty RPF-004 files stay in their original worktree and are not copied
into the release or treated as completed runner execution.

| Parent | Current status / dependency | Actual evidence and remaining gate |
| --- | --- | --- |
| RPF-004 | IN_PROGRESS, requires RPF-002 | Original offline request/signature/lifecycle work has no real controller/transport/replay/containment proof. Current disabled Sandbox adapter, receipts and owned isolation packets are offline preparation. All mandatory real isolation gates remain unverified. |
| RPF-005 | TODO, requires RPF-004 | No trusted structured-result parser integrated with a proven runner. A standalone bounded parser/reporter contract can be prepared; sample counts are not execution proof. |
| RPF-006A | DEFERRED, requires RPF-003 | Explicit user suspension remains. New Meta provider capabilities do not resume the issue-triage workflow. Only explicit user resumption can change this. |
| RPF-006B | TODO, requires RPF-004/005/006A | No approved generated-test execution/freeze workflow. Immutable-byte/static validation primitives can be prepared independently, without calling Meta or accepting a reproduction. |
| RPF-007 | TODO, requires RPF-006B | No real baseline workflow. Existing pure policy handles NO_REPRO, but no approved live baseline evidence or zero-patch-generation integration exists. |
| RPF-008 | TODO, requires RPF-003/007 | Typed source-only proposals exist; no real patcher. Independent owned-fixture AST/path/protected-byte validation and guest no-follow application can be prepared. |
| RPF-009 | TODO, requires RPF-008 | No independently prepared patched execution. New SDK session pinning is not proof of independent retesting or unchanged tests. |
| RPF-010B | TODO, requires RPF-010A/009 | Existing deterministic policy is implemented and unchanged. Trusted actual artifacts/controller provenance are still absent. |
| RPF-011B | TODO, requires RPF-011A/010B | Durable immutable evidence schema exists, but no real orchestrator. Standalone PostgreSQL lease/replay/effect-accounting foundations can be prepared without creating live runs. |
| RPF-012A | TODO, requires RPF-011B and RPF-001C-BE | Existing authenticated catalog/drafts and truthful 503 are real. No authorized full run create/approve/cancel API exists. Read-only owned GitHub intake can be prepared independently. |
| RPF-001C | IN_PROGRESS, requires contract children and RPF-012A/012B | DTO snapshots, safe catalog/error/503 integration exist. Full run/report HTTP and frontend compatibility are not complete. |

RPF-003's historical live observation does not authorize any present request.
RPF-META-001 completed offline typed provider/catalog/accounting boundaries only;
no actual account catalog or enforceable $0 inference entitlement has been proved.
RPF-SBX-002 completed smoke receipt preparation; RPF-ISO-001 prepared independent
statement validation and minimal owned probes. None completes a parent above.

RPF-REPLAY-001 and RPF-JOB-001 now provide independently tested PostgreSQL
replay reservations and a conservative job/lease/possible-effect foundation.
They do not activate the RPF-011B stage machine or dispatch external effects.
Unknown effects quarantine the one global slot until separate reconciliation
exists. See DURABLE_REPLAY.md and DURABLE_JOBS.md for their actual limits.

## Eligible independent local components

RPF-META-002 now adds immutable attempt/usage accounting bound to quarantined
META effects. Missing usage stays unknown; a late observation or reread cannot
grant dispatch or release quarantine. It deliberately does not implement the
positive no-charge reservation controller. See META_ACCOUNTING.md.

Keep each separately scoped, tested and committed, with honest parent status:

- Durable multi-stage orchestration, quota/zero-charge entitlement and usage
  accounting, independent resource observations and effect reconciliation on top
  of the replay/job foundations. An uncertain submitted model/create effect must
  remain quarantined rather than automatically resend after an expired lease.
  No in-memory background execution after an HTTP response.
- Bounded structured-result decoding and an owned reporter protocol. Test output
  alone is not authentic: raw/zero/skipped/setup/timeouts cannot authorize VERIFIED.
- Owned-fixture test/source AST admissibility, exact-byte freezing and constrained
  guest patch preparation. Candidate code must not mutate assertions/reporting or
  protected tests through imports/global side effects; source-only paths alone
  do not prevent that attack. Never execute generated code on the host.
- Read-only exact allowlisted GitHub issue/commit/blob intake with byte limits,
  source/dependency pinning and untrusted-text handling. No remote writes/scripts.
- Additional owned no-follow/hard-resource probe/controller preparation and a
  separate observer/evidence adapter. Minimal probe assets do not cover every
  mandatory live gate yet.

Do not mark RPF-005/006B/008/011B/012A DONE merely because a standalone component
passes. Do not fabricate Run/report/artifact evidence or add a public execution
route to demonstrate progress. Keep both release branches and unrelated dirty
source untouched; frontend remains read-only until its own eligible ticket.

## Consolidated decisions needed after independent work

No routine local approval is needed. A later single request must distinguish:

1. RPF-006A resumption (currently not authorized).
2. Actual Meta account/model catalog access and a provider-enforced no-charge
   entitlement plus bounded live inference approval. Pay-as-you-go without a
   real zero-charge restriction means no inference at the $0 budget.
3. Vercel Hobby account/quotas/image/admin/operator hosting and explicit owned
   live smoke/negative-test approval. Initial concurrency remains one.
4. A separately bounded two-VM exception for simultaneous cross-sandbox proof,
   independent observer credentials/trust roots, owned ready network canaries,
   durable evidence storage/replay and actual runtime/provenance acceptance.

No decision implicitly allows Git push, deployment, paid services, arbitrary
repositories or production writes. Full engine readiness requires a genuine
approved end-to-end issue verification with trustworthy fail-to-pass evidence;
offline mocks, signatures, plan documents and historical results cannot replace it.
