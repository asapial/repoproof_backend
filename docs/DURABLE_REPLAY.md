# Durable execution replay foundation — RPF-REPLAY-001

This component reserves identities; it does not authorize inference, runner
execution, a verdict, RPF-004 completion or RPF-011B orchestration. Live APIs and
cloud execution remain disabled. RPF-006A stays DEFERRED. No Run/report is created.

The fifth additive migration creates ExecutionReplayGroup and ExecutionReplayItem.
Namespace/group identity, item IDs and nonces have independent database unique
constraints. A transaction first reserves the group and then every member. A
collision anywhere rolls back the entire group, including previously inserted
members. There is no per-instance memory fallback, expiry-based deletion or
automatic rearming. Identities must outlive worker/retry retention windows.
Namespace separation supports isolation audits and future runner request/evidence
controllers without confusing their trust boundaries.

PostgresExecutionReplay accepts a trusted shared pool configured through the
existing bounded verified-TLS database options. It implements the isolation
assessment's two-observation store and a bounded generic reservation interface.
Input size/count/UUID case/nonce/duplicate checks precede SQL. Parameterized SQL
and the database clock enforce expiry within five minutes. Transaction-local
statement/lock limits bound contention. A seven-second overall deadline discards
stuck/uncertain connections, including late connection resolution. Unknown COMMIT
disposition returns false: a committed group will block reuse rather than permit
a repeated external effect. It is not safe to automatically create a fresh job
or inference just because the client failed to see its commit acknowledgement.

The repository emits no raw driver errors and has a safe JSON projection. Worker
role gets SELECT/INSERT on the two replay tables only, no UPDATE/DELETE, user/auth/
draft/Run/evidence or migration access. deploy/replay-grants.sql checks the target
and role, refusing a privileged role or an existing API role with user access.
Ordinary API runtime grants are unchanged. Migration ownership remains separate.
No role/connection secret is installed into the app or a guest by this ticket.

integration/rpfreplay001-bootstrap.sql is guarded to the local/CI superuser
rpf_test and rpf012s_disposable. It creates only a separate rpf_engine_disposable
database and limited rpf_engine_replay identity if absent; it never resets/deletes
data. The real integration test additionally requires loopback port35440, exact
database/user names and RPF_REPLAY_GATE=1. Test data is synthetic reservation IDs,
not provider evidence. Cleanup removes only groups created by that test through
the owner observer; the worker itself cannot delete. Previous disposable databases
and historical data are preserved.

Actual PostgreSQL tests cover one of eight independent sessions winning the same
pair, repeated IDs and nonces, whole-transaction rollback on a partial collision,
database-clock expiry, seven privilege denials, bounded index contention and
post-abort recovery. Product Run/report counts remain zero. Offline tests also
cover pool failure/late connections, safe serialization and invalid inputs. Manual
CI is extended but remains unpublished/unrun remotely.

Remaining engine work includes durable job/effect states, ownership/leases,
cancellation/recovery and bounded provider quotas; trusted identity/key registry;
real independently collected probe evidence; actual account no-charge enforcement;
and approved live runner execution. This store cannot establish any of those facts.
Never feed model claims into it as proof of execution or a completed isolation gate.
