# Durable exact-byte preparation — RPF-FREEZE-002

The RPF-FREEZE-001 process-local seal now has a separate immutable PostgreSQL
transport/storage layer. It does not create product Run/Artifact evidence or
activate the RPF-006B workflow. All packages have purpose PREPARATION_ONLY.

## Encoding and authority

Version rpf-frozen-package-v1 contains canonical base64 for the exact frozen
manifest and four source/reference/regression/generated-test files. The 64 KiB
packet is strict compact UTF-8 JSON. Unknown/duplicate keys, bad ordering, path
aliases, altered source/tests, noncanonical base64, invalid UTF-8, byte overflow
and conflicting manifest/hash/count metadata fail closed. Restoration rebuilds
the seal through the pinned fixture hashes and current AST policy, then requires
exact manifest and package equality. No source/test is executed or normalized.

PostgresFrozenPackages accepts a genuine process freeze handle, writes immutable
bytes and validates the returned row. It mints DurableFreeze only after COMMIT
acknowledgement. A lost acknowledgement returns UNAVAILABLE with no capability;
there is no automatic retry or new identity. A later acknowledged load verifies
exact packet/manifest/source/test integrity before creating a fresh private
capability. JSON metadata cannot reconstruct one. All returned test bytes remain
defensive copies through the existing snapshot interfaces.

generateDurableDiscountPatch requires that capability before invoking the
provided server-owned Meta task provider. It binds issue number 1, exact pinned
source bytes/hash and base, then revalidates the provider's source-only response
and AST grammar. Frozen reference/generated/regression tests cannot change.
This storage capability is not a billing, runner, inference or HTTP permission.
Existing Meta catalog/$0 reservation gates still apply; tests supply a synthetic
provider, with no actual inference or generated-code execution.

## Database boundary

The eighth additive migration creates FrozenPreparationPackage with unique
immutable identity/manifest/payload hashes, BYTEA bounds and a database SHA-256
check over the actual bytes. PostgreSQL 16 provides the built-in
[sha256 binary-string function](https://www.postgresql.org/docs/16/functions-binarystring.html);
no extension or external object store is introduced. Existing immutable-evidence
triggers reject update, delete and truncate, including ordinary owner statements.
The dedicated package role receives only SELECT/INSERT on this table and no
user/Run/job/replay/reconciliation/migration access. Guarded grants reject wrong
targets and privileged/combined roles. Old API/worker grants are unchanged.

The store has a seven-second transaction bound, two-second SQL/lock bounds,
late-connection disposal, parameterized queries and fixed redacted errors.
Duplicate acknowledged writes retain the original row/time. Changed content
under an existing ID and new IDs for the same package cannot overwrite/rearm it.
The database digest alone is insufficient: a deliberately checksum-valid malformed
test packet is rejected on read before any patch capability can be minted.

This is private internal preparation storage. Tenant/run ownership, retention,
real stage-machine events, trusted guest artifact collection and independent
baseline/retest provenance still require their blocked parent integrations.
No public read route, deletion bypass, live provider call or production write is
added. RPF-004 IN_PROGRESS; RPF-006A DEFERRED; RPF-006B/011B remain TODO.

## Actual tests and retained synthetic data

Unit tests cover byte roundtrip, CRLF, canonical encoding, tampered manifests,
counterfeit authority, durable acknowledgement ordering, source drift, protected
patch data and storage failures. Real restricted-role PostgreSQL tests cover eight
concurrent writers, exact reload, genuine committed SQL with synthetic lost
acknowledgement, same-ID/content conflicts, proposal calls only after another
connection observes committed bytes, eight privilege denials, three owner-level
immutability denials, checksum failure and malformed reread. Eight migration
checksums, deploy/status/repeat and six unsafe grant targets were checked.

Three immutable synthetic preparation rows (including the malformed negative
case) remain in the explicitly owned disposable tmpfs database. Their IDs are
recorded in the gate log. No trigger was disabled and no deletion privilege was
added to clean tests. All Run/report/job/effect/reconciliation counts remain zero.
The disposable test database's lifetime is not a production durability guarantee.
The first gate from the preserved worktree lacked the newly pinned parser in its
old shared dependencies; the source-hashed review copy passed with its correct
installation, leaving preserved worktree dependencies untouched.

Run integration/rpffreeze002-postgres.ts only in a fresh Node 24 checkout/review
copy with pinned dependencies, the owned loopback rpf_engine_disposable database,
RPF_PACKAGE_GATE=1, RPF_PACKAGE_DATABASE_URL for rpf_engine_packages and
RPF_JOB_ADMIN_URL for rpf_test. It rejects other targets and retains its immutable
synthetic IDs. Exact commands, hashes and outcomes are in the local Goal ledger.
