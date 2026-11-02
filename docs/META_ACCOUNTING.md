# Durable Meta accounting preparation

RPF-META-002 depends on the offline RPF-META-001 provider boundary and
RPF-JOB-001 possible-effect foundation. It implements an internal, append-only
accounting component, not a `MetaAccess` authorization controller. No public route,
provider wiring, catalog request, inference, credential lookup or billing entitlement
is added. `denyMetaAccess` remains the default.

## Identity and recovery

`PostgresMetaAccounting.prepare` binds one immutable attempt to the existing META
effect UUID, job UUID/version, exact request SHA-256, model, output-token cap and
source label. New attempts require the database's current quarantined META effect,
matching context, no cancellation and an unexpired deadline. An independent SQL
trigger enforces those checks for direct INSERTs. Supported caps are 1–65,536 tokens;
model identifiers are bounded ASCII.

An effect/job has at most one attempt. Exact repeats are idempotent; changes to
request, model, source, cap or original job context return no record. Original
identity recovery remains available after cancellation/expiry. Preparation
acknowledges accounting only. It never permits inference, a lease rearm, resubmission
of an uncertain effect or creation of a no-charge reservation.

`record` appends at most one RECEIVED/REJECTED/UNCERTAIN observation. Unknown or
unprepared effects cannot gain observations. Late outcomes can account for an
already prepared effect after cancellation or expiry. Exact repeats succeed;
contradictory outcomes/counts cannot replace the first row. An uncertain record
stays uncertain. Independent findings belong in the separate reconciliation store,
which also cannot release quarantine.

Each transaction has a total bound up to seven seconds and two-second SQL/lock
limits. Errors and lost commit acknowledgements return UNAVAILABLE without driver
details or automatic retry. COMMIT may have succeeded: reread the original effect
identity through a fresh connection. Never generate a new identity or repeat a
provider request to recover accounting. These SQL bounds do not make a five-second
lease or a 15-second Function sufficient for actual provider execution.

## Counts and trust

Missing usage is `null`, including for RECEIVED. It is never converted to zero.
Reported zero is retained separately. Prompt/completion/total counts must be
nonnegative safe integers, with `total = prompt + completion`. Optional cached/
reasoning counts stay optional and cannot exceed their containing counts. Unknown
fields and malformed nested details fail closed. SQL constraints independently
enforce arithmetic, bounds and null consistency. Over-cap completion usage is
retained and flagged, so accounting cannot hide a provider limit violation.

Canonical metadata digests bind attempts/observations; every read reparses and
recomputes them. They detect malformed stored metadata, not provider origin,
delivery or billing. OFFLINE_SYNTHETIC and LIVE_UNVERIFIED are labels, not verified
provenance. Prompts, responses, keys, cost estimates and billing claims are absent.

Every record says `dispatchAllowed: false`, `noChargeEntitlementVerified: false`,
`independentReviewRequired: true`. Even RECEIVED with positive counts cannot
authorize VERIFIED, zero cost, retry or quarantine release. This class deliberately
does not implement `MetaAccess`. Current [official pricing](https://dev.meta.ai/docs/pricing-rate-limits)
describes pay-as-you-go token charges (checked November 2, 2026). No real account's
provider-enforced $0 entitlement is established. A key, credit, contributor
discount, spend alert, caller boolean or local digest is insufficient.

## Storage and role

Migration nine creates `MetaAttemptAccounting` and `MetaUsageObservation`. Both
reject UPDATE, DELETE and TRUNCATE, including ordinary table-owner SQL. Their
referenced jobs/effects remain durable too. No retention bypass or administrative
quarantine release is introduced.

`deploy/meta-accounting-grants.sql` requires the approved database and a dedicated
existing limited role. It grants job/effect SELECT and accounting SELECT/INSERT
only: no job mutation, effect insertion, replay/reconciliation, preparation packages,
auth, Run/report or migration privileges. Worker/replay/observer grant scripts
reject the accounting role to prevent accidental role combination. Never expose
this role to HTTP or the future dispatcher.

## Accepted local evidence

Node 24.22.2: 34 focused tests and full 550 tests in 39 files passed, plus lint,
source/integration types, production build, lint-toolchain and full/production
audits with zero findings. Owned disposable PostgreSQL 16 passed all nine migration
checksum/status/repeat checks, eight-client idempotent preparation, actual committed/
lost-ack usage recovery, late cancelled accounting, 13 data guard denials, 12
privilege denials, six owner mutation denials and 11 unsafe grant targets. Four
existing role grants and the real restricted job regression passed.

The immutable synthetic attempt/outcome and referenced cancelled quarantined
job/effect remain in `rpf_engine_disposable`, with the three earlier immutable
preparation rows. The global slot remains QUARANTINED. Never weaken constraints or
delete protected rows to rerun a gate. Integration identities and exact logs live
in the local Goal ledger under `output/meta-engine-2026-11-02/evidence/meta002-*`.
Product Run/report counts and actual provider calls stayed zero. This metadata
represents a synthetic possible effect, not an executed inference.

Remaining: genuine no-charge entitlement/controller, approved account access,
multi-stage durable orchestration, trusted observations, real Sandbox execution/
isolation and genuine fail-to-pass E2E. Parent RPF-011B remains TODO, RPF-004
IN_PROGRESS, RPF-006A DEFERRED.
