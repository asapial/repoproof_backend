# Durable stage journal preparation

RPF-STAGE-001 adds an internal PostgreSQL preparation journal, not the live
RPF-011B worker. It dispatches no jobs/providers/code and creates no product Run/
report. Every view's record has `mode: OFFLINE_PREPARATION`; the view has
`dispatchAllowed: false`, `productionVerdict: INCONCLUSIVE`.

The successful preparation path is OPEN → INTAKE_ACCEPTED → FROZEN → BASELINE_FAILED
→ BASELINE_CLEAR → PATCH_READY → PATCHED_PASS → AWAITING_TRUST_REVIEW. These states
record ordered references, not authenticated execution facts. The controller must
still validate intake, frozen bytes, receipts, artifact equivalence and independent
provenance before proposing corresponding observations. A digest/outcome is not proof.

An allowed FREEZE names an existing immutable package UUID and matching manifest
digest; subsequent rows retain that identity. The store reads only package UUID/
manifest columns. It cannot read payloads or mint private freeze capabilities.
Patch generation continues to require the separate RPF-FREEZE-002 private capability.

A baseline PASS ends at NO_REPRO_PREPARATION, with no patch stage permitted.
Assertion failure and passing baseline regressions must precede patch preparation.
The patched issue must pass before patched regressions. Non-passing observations
stop preparation. Uncertain observations quarantine the flow; cancellation can mark
that quarantine cancel-requested but cannot release it. There is no retry/rearm.

Cancellation/expiry terminate active flows. Advances at or after the original
deadline fail. Expiry cannot precede the deadline, release quarantine or restart
completed states. The one-hour maximum preparation lifetime is an upper workflow
bound, not demonstrated execution time, a provider lease or Function capability.

Each row stores bounded canonical metadata, SHA-256, previous digest, flow/request,
original deadline, sequence, stage/outcome/reference, frozen identity and derived
state/cancel flag. There are at most 16 rows of 4 KiB per flow. No source, prompts,
responses, credentials or raw logs are stored. Migration ten independently enforces
field/payload equality, SHA-256, chains, transitions, freeze metadata and deadlines.
A transaction advisory lock serializes each flow; database acceptance time is set
after acquiring it. Exact duplicates are idempotent; conflicts fail. Ordinary
UPDATE/DELETE/TRUNCATE are blocked, including table-owner operations.

The store uses exact expected sequence/digest CAS. Each load reparses canonical
bytes, verifies digests/identities, replays transitions at database acceptance times
and rechecks frozen metadata. It never trusts the final state column alone. Exact
acknowledgements stay recoverable after expiry and return the latest validated view.
Old conflicting commands cannot overwrite history.

Transactions have a seven-second total maximum and two-second SQL/lock limits.
Lost COMMIT acknowledgement returns UNAVAILABLE without retry: reload the original
identity. Never create a fresh flow to resend an unknown external effect. No
dispatch capability exists here, and the existing ExecutionJob/global quarantine
is unchanged. These bounds do not solve the five-second lease/15-second Function/
provider timing mismatch. No background work follows an HTTP response.

The guarded dedicated-role script grants journal SELECT/INSERT and only package
UUID/manifest SELECT. Payloads, jobs/effects, accounting, reconciliation, replay,
auth, Run/report and migrations stay inaccessible. Five other role scripts reject
the journal role; existing roles retain separate grants. No API wiring changes.

Node 24.22.2: 15 focused/full 608 tests in 41 files, lint, source/integration types,
build, lint-toolchain and zero full/production audits passed. Real owned PostgreSQL
16 passed ten migration checksum/deploy/status/repeat checks, eight-client append,
lost real committed acknowledgement recovery, full preparation/NO_REPRO/quarantine/
cancel/expiry paths, 14 data/13 privilege/three owner mutation denials, 13 unsafe
grant targets and five existing-role grants. The second accepted run added the
direct freeze-metadata denial and preserved the first five flows. All ten immutable
synthetic flows/38 rows remain; the prior cancelled quarantined job/effect/accounting
and three packages are unchanged. Product Run/report and actual provider calls
stay zero. Exact identities/logs are in the local Goal ledger `stage001-*`.

Actual live stage controller/worker, no-charge entitlement, trusted execution/
reporter/artifact observations and approved reconciliation remain pending. Parent
RPF-011B stays TODO, RPF-004 IN_PROGRESS, RPF-006A DEFERRED.
