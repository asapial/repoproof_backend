# Hard-resource probe preparation

RPF-ISO-002 adds two separately pinned owned negative assets and claimed-fact
consistency checks. No asset is executed by preparation, tests, imports or this
application. Host, Docker, web/orchestration workers and arbitrary repositories
must never run these probes. RPF-004 remains IN_PROGRESS; no resource/isolation
acceptance, Run/report or production verdict is created.

`prepareResourceProbe` returns fixed Node argv, no sudo/env override, 5-second
command/30-second lifetime limits, 1 vCPU/2 GiB memory, 16 KiB output and concurrency
one. Its return explicitly denies execution. A fresh nonce, exact image/bundle,
input and command digests bind the packet. It reads only the two fixed regular
asset paths, checks their hashes and clones their bytes. Original ISO-001 and
discount fixture bytes are unchanged. Existing model policy protects isolation
paths; no arbitrary command, size, URL, concurrency or script option is accepted.

The memory asset retains 64 MiB buffers and touches each 4 KiB page, up to a fixed
3 GiB negative ceiling against the future 2 GiB guest policy. It emits bounded
progress markers. Reaching the ceiling exits 80 with LIMIT_EXCEEDED; allocator
errors exit 82 and do not prove provider enforcement. The CPU asset starts exactly
two workers, emits STARTED after both are online, and stays busy until external
command/VM termination. Worker errors exit 83. It has no self timer/success exit.
Both require the exact approved guest path, non-root Linux and a small fixed-mode
nonce input. Input opens are no-follow/nonblocking, regular single-link and bounded
to 1 KiB, with bounded read and size recheck. These guards do not authorize host
execution or replace an approved disposable guest.

## Observation consistency, not authenticity

Canonical observations are limited to 16 KiB with strict types, identities and
safe integer counters. Session/execution/cgroup-scope and nonce/image/bundle/input/
command bindings must match the separately supplied expected scope. Duplicate,
prototype/unknown, noncanonical and malformed fields fail closed. Controls require
a start marker, bounded positive sample, matching provider allocations and cleanup.

For memory, allocator/V8 failures and timeout alone are insufficient. Claimed
cgroup OOM termination must correlate with an increased kill counter and a peak
near the configured maximum. Peaks below 75% or above the cap stay insufficient,
requiring review. This strict preparation rule does not assert how a provider
accounts transient memory. For CPU, claims require two workers, at least three
seconds, a one-core quota/period, zero burst setting, increased throttling and
positive CPU usage. Usage above wall budget plus one quota period contradicts
the claimed limit; insufficient pressure stays unknown. No exit/timeout alone
establishes CPU enforcement.

Returned facts are MATCHED/CONTRADICTORY/INSUFFICIENT. OFFLINE_SYNTHETIC can never
be ready for live review. UNVERIFIED_OBSERVER_CLAIM may be structurally ready for
independent review, but always retains `authentic: false`, `rpf004Complete: false`.
Nothing creates a passing isolation gate. An approved independent observer must
establish dedicated cgroup ownership, actual counters/termination, correct workload
and cleanup; bind/sign the real facts; and satisfy all existing isolation gates.
Guest stdout, copied fields, identical hashes or signed statements alone do not
prove them. Missing provider visibility is a blocker, not a waiver.

## Local checks and live prerequisites

Node24 38 focused and full 684 tests in 43 files, lint/types/build, lint-toolchain
and full/production audits with zero findings passed. Tests read/hash and parse
source bytes with the pinned Babel parser; they never import or execute either
asset. Synthetic cases cover malformed/binding/control/counter/pressure failures
and forbid false live readiness. Review added worker-online positive control and
reran gates against the final asset hashes. Exact commands/logs live in the local
Goal ledger `iso002-*`.

Later live approval must explicitly include forced-memory/OOM and CPU-pressure
negative probes in separately disposable owned VMs, with approved image, $0 quota,
one-VM-at-a-time scheduling, independent cgroup/provider visibility and bounded
cleanup/reconciliation. This approval is separate from the simultaneous two-VM
cross-sandbox exception. No new provider request, image, container, cloud resource
or quota consumption occurs here. The Node 24 [worker API](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)
and Linux [cgroup v2 counters/limits](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
were checked as primary API references, not live provider evidence. RPF-006A remains
DEFERRED and all incomplete engine parents keep their existing status.
