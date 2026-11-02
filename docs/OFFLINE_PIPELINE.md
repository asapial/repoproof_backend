# Closed synthetic component pipeline — RPF-OFFLINE-001

`simulateOfflineDiscount` connects the existing Meta task schemas and the new
pinned intake, AST admission, exact-byte freeze, source-only patch preparation,
receipt decoder and deterministic verdict policy. It is a closed offline test
harness. Its only selectable inputs are the owned snapshot data and a fixed
scenario enum. Callers cannot supply a provider, executor, shell command, URL,
runtime script, receipt, trust flag or arbitrary callback.

All model proposals and execution receipts come from deterministic synthetic
fixtures in offlineFixtures.ts. The MetaTaskProvider receives a static synthetic
catalog/generator with no MetaAdapter instance, key, HTTP transport or account
access. Curated issue data enters the existing DATA_ONLY boundary; issue triage
is not invoked and RPF-006A remains suspended. Test/source text is parsed and
copied as data, never imported, transpiled, evaluated, run in a VM or executed.
No sandbox, product run/report, replay reservation or job is created.

## Sequencing and policy exercise

The successful simulation traces intake, generated test, freeze, baseline issue,
baseline regressions, patch request, protected source preparation, patched issue,
patched regressions and simulated decision. Sequence numbers are assigned
internally. The generator cannot receive a patch request before the frozen test
and successful baseline/regression gates. A passing baseline returns simulated
NO_REPRO with zero patch attempts and no patched receipt. Invalid preparation,
baseline setup/skip/zero/timeout/hash/artifact evidence and baseline regression
failure cannot request a patch.

Each synthetic receipt binds the current snapshot/frozen/test/image/command and
its unique simulated stage/suite execution ID. The harness decodes protocol
bytes, separately compares complete returned artifact bytes, and preserves exact
frozen test hashes across independently prepared baseline/patched snapshots.
Contradictory success receipts cannot conceal changed test artifacts. Only the
deterministic policy assigns the nested simulated verdict; model success claims
and source paths never directly authorize a verdict.

Every return is labeled SYNTHETIC_OFFLINE_FIXTURE. `policySimulation` may contain
VERIFIED only for the internally consistent positive fixture. The separate
`productionVerdict` is always INCONCLUSIVE, with liveProviderCalls=0. This is
deliberate: sample receipts and artifact buffers do not prove real assertion
execution, reporter honesty, isolation or approved provider operation.
Uncertain simulated execution stops further work, sets reconciliationRequired
and records QUARANTINED in the simulation trace. It does not create or release a
real job, resend a provider request or assert actual VM cleanup.

## Adversarial coverage and remaining gates

Thirty-one fixed scenarios cover fail-to-pass, no-repro, skipped/empty generated
tests, model claim/schema injection, generator failure, zero/skipped/setup/timeout/
malformed/mismatched baseline and patched receipts, exact-byte test tampering,
baseline and patched regression failure, unsuccessful patches, protected paths,
global mutation, stale source/base identity, image/phase swapping, cancellation
and uncertain execution. Tests verify deterministic output, complete state order,
immutable results, unchanged input bytes and zero fetch calls for every scenario.

This proves component behavior with synthetic responses only. It is not the
durable live orchestrator, trusted reporter, no-follow guest writer, independent
observer/controller, actual Meta inference, actual Vercel execution or genuine
baseline-fail/patch-pass E2E. Those gates and the canonical parent dependencies
remain. RPF-004 IN_PROGRESS; RPF-006A DEFERRED; RPF-005/006B/007/008/009/010B/011B/
012A/001C retain their prior uncompleted statuses. Public Run stays unavailable.
