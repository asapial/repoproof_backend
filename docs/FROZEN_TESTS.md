# Exact-byte test freezing — RPF-FREEZE-001

This standalone module requires the owned fixture's exact three pinned files
and an AST-admitted generated issue test. `freezeDiscountTest` copies all bytes
into module-private storage and seals a deterministic SHA-256 manifest before
any patch can be prepared. Manifest entries bind path, length, original byte
digest and static test/assertion counts. CRLF, comments and whitespace remain
exact. No source or test is executed, transformed or normalized.

`prepareBaseline` and `prepareDiscountPatch` require a genuine in-process freeze
handle. Serialized, forged and cross-freeze metadata cannot restore authority.
The patch operation accepts one byte replacement for `src/discount.mjs` with
the original SHA-256. It rejects stale, duplicate, empty, no-op and inadmissible
patches, extra fields and every other path. All reference/generated/regression
tests remain protected. Lockfiles, package scripts, CI, environment and runner
configuration cannot enter the fixed four-file snapshot at all. No filesystem
patch, extraction, shell command or caller-controlled execution path exists.

Buffers are never exposed by reference. Returned artifact bytes are fresh copies;
manifests, entries and handles are frozen objects. Original input and returned
buffer mutation cannot change the seal. Baseline/patched snapshot digests bind
the same frozen manifest and complete ordered file digest list.
`frozenTestsEquivalent` checks the common freeze identity and exact protected
bytes. `snapshotBytesMatch` compares separately collected complete artifact
bytes to the expected snapshot, including source, and rejects extra, duplicate,
missing, aliased or modified files. These checks must run on independently
collected artifacts in a future trusted execution controller.

This is an immutable in-process preparation capability, not durable artifact
storage, a guest no-follow writer, a provenance attestation or an execution
verdict. Process restart deliberately loses capability; a future authenticated
durable store must independently validate persisted manifest/bytes and enforce
freeze-before-patch event order. A file hash alone cannot prove that order.
Real runner containment, provider operations and freeze persistence remain
unavailable. RPF-006B remains TODO; RPF-004 IN_PROGRESS; RPF-006A DEFERRED.

Unit tests read fixture bytes as data and use inert synthetic patch/test bytes.
They cover mutation, counterfeit handles, path and protected-file bypasses,
stale source digests, malformed/admission failures and full artifact mismatch.
Current checks and commits are recorded in TASK_BOARD.md and the local progress
ledger under output/meta-engine-2026-11-02.
