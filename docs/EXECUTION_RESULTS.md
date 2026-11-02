# Structured execution-result protocol — RPF-RESULT-001

Version `rpf-result-v1` defines a bounded typed receipt for an eventual owned
reporter/controller. No reporter executes tests in this ticket. Decoder inputs
are inert bytes; stdout, model output and guest claims do not become trusted
evidence merely because they match the schema. Every decoded result explicitly
has `authentic: false` and has no verdict field or execution permission.

The trusted caller must supply an execution plan derived from independently
sealed artifacts, commands and observations. Binding includes run/execution UUID,
baseline/patched stage, issue/regression suite, base commit, frozen manifest,
complete source snapshot, exact test bytes, runner image and command hashes.
Plans specify positive expected test/assertion counts and a finite duration
bound. Receipt provenance must match either SYNTHETIC_OFFLINE_FIXTURE or
UNVERIFIED_GUEST_OUTPUT. Neither label is an authenticity credential.

Receipts include numbered per-test outcomes, assertion counts and failure kinds,
summary counts, exit status, timeout/setup flags, start/end time, stdout/stderr
digests and the claimed observed-artifact manifest digest. No raw output,
credentials, issue text, arbitrary paths, successful-verdict claim or extension
fields are admitted. A future controller must independently collect artifacts
and check actual bytes, process status, reporter identity and containment. A
matching artifact digest claimed inside an untrusted receipt cannot prove them.

The encoding is exact compact JSON in schema property order. Fatal UTF-8 decoding
and a 65,536-byte cap reject invalid, oversized, BOM, trailing and noncanonical
data. Re-encoding parsed schema data and comparing exact bytes rejects duplicate
keys, unknown fields, alternate number spellings and ambiguous field order.
This is intentionally stricter than generic JSON. Parser/schema exceptions
produce fixed errors without reflecting supplied content.

Decoder invariants enforce contiguous unique test numbers, finite safe bounds,
ordered time, exact summary/per-test sums, positive assertions for passed tests,
one failing assertion for an assertion-failed test, no assertions on skipped
tests, no impossible failure/exit combination and no assertion count above the
plan. Malformed, mismatched and inconsistent evidence returns a failure.

Classification is separate from policy and trust. PASS requires the complete
planned tests and assertions, zero skips/failures, exit zero, no timeout/setup
failure and duration within the plan. ASSERTION_FAILURE requires all tests
accounted for, nonzero exit and only assertion failures. Other structurally
valid observations are INCONCLUSIVE, including zero or missing tests, skipped
tests, setup/import/syntax/unknown failures, timeouts, null/inconsistent exits,
missing assertions and excess duration. No classification itself issues VERIFIED.

Tests use explicitly synthetic receipt data. They exercise strict decoding,
every binding, contradictory counts and non-success cases. They do not prove
live provider execution, test discovery, reporter authenticity or isolation.
RPF-005 remains TODO pending its actual RPF-004 dependency and trusted reporter
integration. RPF-004 stays IN_PROGRESS; RPF-006A stays DEFERRED.
