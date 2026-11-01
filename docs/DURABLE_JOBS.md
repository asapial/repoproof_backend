# Durable control-plane jobs — RPF-JOB-001

This is a PostgreSQL foundation, not the live RPF-011B orchestrator. It creates
no product Run/report, public endpoint, provider permission, verdict, cloud
resource or background task. RPF-004 remains IN_PROGRESS and RPF-006A remains
DEFERRED. Existing HTTP runner requests still return RUNNER_UNAVAILABLE.

## State and ownership

The sixth additive migration adds ExecutionJob and ExecutionEffect, separate
from immutable product evidence. A trusted caller supplies the authenticated
owner identity and a stable idempotency UUID plus the exact request hash. This
internal store does not authenticate arbitrary owner strings: exposing it to an
HTTP route without session/CSRF/authorization checks would be unsafe.

Submit is idempotent within an owner. The original deadline and request binding
never change; another body under the same key returns no job. Owner-scoped get
and cancel return no information for another owner. Status projections exclude
owner identifiers, request digests, private lease proofs and provider details.
SQL is parameterized. No issue text, code, credentials or raw provider payloads
are stored in these control tables.

States are QUEUED, LEASED, QUARANTINED, CANCELLED and EXPIRED. There is deliberately
no successful run/verdict state. Database time bounds a job deadline to five
minutes. A claim has a five-second lease and increments a monotonic version and
attempt count. There are at most three no-effect attempts. Release is a
version/proof/deadline compare-and-swap. A stale lease cannot act after another
transition. Lease proofs are random, hashed in PostgreSQL and retained only in
a module-private WeakMap. A serialized or forged ExecutionLease has no proof.
Losing invocation memory requires recovery rather than reconstructing a token.

One partial unique index permits at most one LEASED or QUARANTINED row globally.
Claims also use a transaction-scoped advisory lock and SKIP LOCKED row selection.
The database index remains a backstop even if a claimant races or ignores the
advisory lock. See the PostgreSQL 16 [locking clause](https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE)
and [partial indexes](https://www.postgresql.org/docs/16/indexes-partial.html).

## Interruption and uncertain external effects

Recover handles at most 100 stale rows per bounded transaction. A lease lost
before any possible external effect may return to QUEUED, provided its deadline
and attempts permit that. Cancel invalidates an ordinary active lease. Expired
deadlines and exhausted attempts cannot rearm a job.

recordPossibleEffect records a fixed META or SANDBOX request identity/hash.
The database trigger atomically invalidates the current lease and immediately
quarantines the job. This is a conservative uncertainty record, **not a dispatch
permission**. It permits one effect intent per job in this foundation. It cannot
yet model the many independently reconciled stages of a full verification run.

Quarantine retains the global slot across lease expiry, cancellation and process
restart. Cancel records the request but cannot claim a possibly running VM was
stopped. There is no ordinary worker unquarantine, effect update/delete, expiry
deletion, automatic resend or cleanup claim. A monotonic SQL guard prevents
identity/deadline changes, terminal-state revival and quarantine release.

Every store operation has a seven-second total deadline, two-second statement/
lock bounds and late-connection disposal. A lost COMMIT acknowledgement returns
UNAVAILABLE even if PostgreSQL committed. The store never retries automatically.
Callers must retain original request/effect identities and inspect durable state;
they must never invent another key to repeat an unknown external request.

## Permissions and actual checks

deploy/job-grants.sql refuses a wrong target, privileged/member role, table owner
or existing API/replay role with user, Run or replay access. The separate trusted worker receives
SELECT/INSERT/UPDATE on jobs and SELECT/INSERT on effects. It receives no DELETE,
effect UPDATE, auth/user/draft/Run/evidence/replay/migration privileges. Ordinary
API runtime grants are unchanged. This role is a control-plane trust boundary,
not a substitute for owner checks or a general credential for the web app.

integration/rpfjob001-bootstrap.sql only prepares a missing synthetic local/CI
identity in the explicitly owned loopback disposable database. The real PG gate
tests owner/idempotency isolation, eight independent claimants, CAS, three-attempt
bounds, a genuinely elapsed lease, cancellation/deadline recovery, index and
transition guards, lost commit acknowledgement, cancel/effect races, uncertain
effect quarantine and nine privilege denials. Test cleanup deletes only its
synthetic UUIDs using the migration owner; product Run/report counts stay zero.
No fixture, generated source, Meta API or Sandbox is executed in these checks.

Run after migrations and limited grants with Node 24:

```powershell
$env:DATABASE_URL='postgresql://rpf_engine_jobs@127.0.0.1:35440/rpf_engine_disposable'
$env:RPF_JOB_ADMIN_URL='postgresql://rpf_test@127.0.0.1:35440/rpf_engine_disposable'
$env:RPF_JOB_GATE='1'
npx --no-install tsx integration/rpfjob001-postgres.ts
```

## Remaining integration gates

The worker is not wired to the web app or any provider. There is no zero-charge
entitlement controller, billable dispatch, durable usage ledger, independently
observed resource receipt, cleanup/reconciliation worker, quota allocator,
scheduler or full stage machine yet. It cannot prevent or locate a real orphan
VM until those separately approved integrations exist. Quarantine chooses
unavailability over a duplicate unknown effect; operators must not delete real
unknown intents merely to restore service.

The current five-second lease and seven-second store bound do not by themselves
make the existing longer provider operations fit a 15-second Function. Activation
requires an explicit bounded invocation plan within approved hosting limits and
durable external-effect reconciliation; no work may depend on surviving after an
HTTP response. No polling/cron/infrastructure or higher concurrency is enabled.
Parent RPF-011B remains TODO until its real dependencies and workflow pass.
