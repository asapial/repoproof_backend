# Owned reporter protocol preparation

RPF-REPORTER-001 defines `rpf-reporter-v1`, a bounded dedicated-channel event
protocol and collector layered on RPF-RESULT-001. It executes no tests, opens no
files or processes, and imports no generated/fixture source. It does not implement
an actual guest assertion counter, live Node reporter wiring or trusted evidence
collection. Those require an approved pinned guest runtime and independent observer.

[Node 24 test events](https://nodejs.org/docs/latest-v24.x/api/test.html#class-testsstream)
include test results, summaries and process output; the documented payloads do not
provide executed assertion counts. A passing test event alone cannot supply those
counts. This component therefore requires explicit assertion events from a future
owned counter, with separate protection and validation. Synthetic events in unit
tests exercise the protocol only.

## Binding and framing

The trusted controller supplies the execution plan and expected assertions per
test, derived from exact admitted frozen bytes and protected commands. There are
1–16 tests and 1–32 assertions per test; the blueprint must equal the plan's totals.
It is cloned at construction. START contains SHA-256 of the complete versioned
plan/blueprint. Changing run, phase, suite, bytes, image, command or counts changes
that binding. A digest is not an origin credential.

Events are exact canonical compact JSON, one newline-terminated object per line.
The collector accepts arbitrary byte chunk boundaries, validates fatal UTF-8,
and caps the total stream at 131,072 bytes and each line at 1,024 bytes. Unknown,
duplicate/escaped duplicate, prototype, extension, noncanonical numeric/key-order,
CRLF, BOM and raw text inputs fail closed. No error text, paths, source, tokens,
credentials or verdict fields belong in this protocol.

Sequence numbers are contiguous. START comes first. Tests run sequentially with
contiguous indices; TEST_START cannot nest or duplicate. Assertion indices must
be contiguous within that test and stay within the blueprint. A failed assertion
must be the last assertion before a consistent failed TEST_END. Passing TEST_END
requires every planned assertion to have explicitly passed. Skips cannot contain
assertions. Non-assertion failures cannot claim a failed assertion. END is unique,
cannot interrupt an active test and admits no trailing event. EOF requires both
END and final newline. The first error stays fatal; finish is one-shot.

## Completion and trust

The controller supplies process exit, timeout/setup flags, observation times,
stdout/stderr hashes and independently observed artifact-manifest hash outside
the event channel. The collector derives receipt counts from events, never from
a guest summary, and calls the existing result decoder for cross-checks. Missing/
zero/skipped tests, absent assertions, setup/import/syntax/unknown failures,
timeouts, bad exits and incomplete framing cannot produce a passing classification.

All accepted results retain `authentic: false`, including apparently perfect
UNVERIFIED_GUEST_OUTPUT. The collector adds the exact event-stream digest, no
verdict or execution permission. A forged stream can imitate well-formed events;
matching counts/hashes do not authenticate it. Raw stdout, model text or ordinary
Node events must never be promoted into trusted assertion observations. Actual
containment, test discovery, assertion instrumentation, protected reporter/image,
independent artifact/process observation and provenance remain live prerequisites.

Transport duration/cancellation belongs to the caller; this synchronous collector
does bounded work per bounded chunk and never schedules background execution.
It is unregistered and does not change normal API behavior or deterministic policy.
RPF-005 remains TODO; RPF-004 IN_PROGRESS; RPF-006A DEFERRED.
