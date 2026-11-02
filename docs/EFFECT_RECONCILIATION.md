# Durable uncertain-effect observations — RPF-RECON-001

This is an offline control-plane foundation over RPF-JOB-001. It does not
dispatch providers, release quarantine, create product runs/reports, enable a
scheduler or complete RPF-011B. Every accepted observation returns
KEEP_QUARANTINED, redispatchAllowed=false, releaseAllowed=false and
independentFactsReviewRequired=true. Cancellation, deadline expiry, NOT_FOUND,
reported cleanup and reported no-charge completion cannot waive that boundary.

## Independent statements

Version rpf-reconciliation-v1 binds the exact job/effect/version/kind/request
hash, cancellation/deadline snapshot, observer key, provider-identity digest,
state, cleanup/accounting claims, facts digest and a five-minute maximum
observation window. Only canonical bounded UTF-8 JSON is accepted. Unknown or
duplicate fields, altered signatures, stale/future context, inconsistent facts,
unsupported keys, duplicate registry identities and dispatcher/observer key
reuse fail closed. The configured observer key must have the dedicated purpose;
LIVE_PROVIDER additionally requires explicitly approved live identity.

The signature domain is repoproof.reconciliation.v1. Ed25519 verification uses
the official Node 24 crypto API; see [crypto.verify](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback).
Only private in-process handles can reach append. Serialization cannot forge a
checked handle. Signature validity proves authorship, not the truth of provider
facts. Synthetic observations stay labeled OFFLINE_SYNTHETIC. No synthetic key
or statement is evidence of real cloud observation, settlement or VM cleanup.

## PostgreSQL persistence

The seventh additive migration creates ExecutionReconciliation without changing
old migrations or job transitions. It stores the complete signed statement's
fields, payload/facts/key hashes and signature, without raw provider IDs,
credentials, output or issue text. Foreign keys, unique evidence/payload and
observation identities, exact current context, database-clock freshness and
effect-created ordering reject malformed/stale/cross-effect inserts. Schema
qualification and a fixed function search path prevent temporary table shadowing
of the new guard. Existing quarantine/global-slot/transition guards remain intact.

The separate observer role gets SELECT on jobs/effects and SELECT/INSERT on
observations. It cannot update/delete/truncate observations, create effects,
change jobs or access user/Run/migration data. Guarded grants reject API,
privileged, dispatcher and replay roles; reverse worker/replay grants now reject
an observer role too. Ordinary worker/API grants gain no observation access.
Append-only access is enforced by role privileges, as documented by
[PostgreSQL 16 GRANT](https://www.postgresql.org/docs/16/sql-grant.html).
The trusted migration owner retains administrative powers and may clean only
explicit synthetic IDs in the disposable database during tests.

Appending the same identity/hash is idempotent. Changed content under the same
ID and reused observations under new IDs are rejected. A lost COMMIT
acknowledgement returns UNAVAILABLE without resending or creating another ID.
Load reconstructs the exact signed bytes and checks their stored digest, but
returns authentic=false. Restart/retrieval requires fresh signature/trust/context
assessment, never automatic authority restoration. Historical cancellation
fields are stored so signatures remain reconstructible after job changes.

Store operations have bounded seven-second transactions, two-second SQL/lock
bounds and disposal of late connections. Queries are parameterized and have
explicit parameter casts. No ordinary observation operation releases the global
slot. Invalid or uncertain outcomes retain their original durable effect.

## Runtime and remaining gates

reviewProviderTiming requires sufficient lease time for durable intent reserve
and sufficient invocation time for both SQL budgets, the complete provider
operation, cleanup and a safety margin. It never grants dispatch permission.
The existing five-second lease/seven-second SQL/15-second Function combination
does not meet these worst-case bounds. A larger hypothetical compatible plan
does not change hosting configuration, approved quotas or any actual lease.
No background-after-response execution, polling service or new cloud resource
is introduced. Real provider lifecycle, quota/zero-charge entitlement, independent
fact collection, resource cleanup and a separately reviewed release protocol
remain mandatory before activation. RPF-004 IN_PROGRESS; RPF-006A DEFERRED.

## Actual local gates

The owned loopback tmpfs PostgreSQL container was restarted, its empty disposable
engine database recreated, and all seven migrations applied/status/repeated.
Restricted-role tests exercise eight concurrent appends, exact restart reread,
real committed SQL with synthetic lost acknowledgement, stale/cancelled context,
expiry/quarantine, ten privilege denials and nine independent database guard
denials. Seven unsafe/reverse grant cases reject. Existing real PostgreSQL job
regressions cover both META and SANDBOX intents, eight claimants, no-effect retry
bounds, elapsed lease/deadline recovery and nine worker privilege denials.
Product Run/report counts stay zero and scoped synthetic rows are cleaned.
An initial ambiguous SQL parameter failure was retained and fixed with explicit
casts; accepted database and final quality checks are in the local ledger.

Reproduce only with the explicitly owned disposable roles/database, after
migrations, integration/rpfjob001-bootstrap.sql, integration/rpfrecon001-bootstrap.sql
and the guarded job/reconciliation grants:

```powershell
$env:DATABASE_URL='postgresql://rpf_engine_jobs@127.0.0.1:35440/rpf_engine_disposable'
$env:RPF_JOB_ADMIN_URL='postgresql://rpf_test@127.0.0.1:35440/rpf_engine_disposable'
$env:RPF_RECON_DATABASE_URL='postgresql://rpf_engine_reconciliation@127.0.0.1:35440/rpf_engine_disposable'
$env:RPF_RECON_GATE='1'
npx --no-install tsx integration/rpfrecon001-postgres.ts
```
