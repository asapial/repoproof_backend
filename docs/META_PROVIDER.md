# Meta Model API provider — RPF-META-001

This is offline provider preparation. No key was read, authenticated catalog
requested or inference performed for this ticket. RPF-003's prior live observation
is historical and grants no present billing permission. Current authorized spend
is $0; RPF-006A remains DEFERRED and no triage workflow is resumed. `/runs` still
returns RUNNER_UNAVAILABLE. No Run, patch execution, evidence or verdict is created.

## Product and official protocol

Current official product is Meta Model API, not OpenRouter or an interchangeable
Llama reseller. The fixed endpoint is https://api.meta.ai/v1. Authentication uses
MODEL_API_KEY as Bearer credentials; META_MODEL_ID must be explicitly selected.
There is no default model. MetaCatalogClient reads authenticated GET /models and
validates its documented list/model/created/owned_by shapes. MetaTaskProvider
requires the selected model in that fresh account catalog before every generation.
Catalog access itself defaults denied and requires separate trusted read approval.
It never infers account access from a public documentation example or old receipt.

References checked November 1, 2026:
[API](https://dev.meta.ai/docs/api-reference),
[catalog schema](https://dev.meta.ai/docs/api-reference/models/schemas),
[structured output](https://dev.meta.ai/docs/structured-output),
[pricing and limits](https://dev.meta.ai/docs/pricing-rate-limits),
[errors](https://dev.meta.ai/docs/error-handling).
The published API is pay-as-you-go. No enforceable free entitlement for this
account has been established. A key, remaining credit, discounted Contributor
variant, spend notification or local budget estimate is not a $0 billing guard.
Contributor mode is not selected automatically and implies separate data-use terms.

## Prepared capabilities and trust boundary

The existing MetaAdapter remains the completion transport; its earlier timeout,
stream bounds, cancellation, structured output, token cap and 429 backoff tests
are reused. New server-internal task contracts cover issue analysis, generated
regression-test bytes and source replacements. They are capabilities only, not
the suspended RPF-006A workflow or test-first orchestration. Model code is returned
as untrusted bytes; nothing writes/imports/executes it. Outputs cannot contain a
verdict or command field. Exact base SHA, original source hashes, approved source
paths and duplicate checks constrain patch proposals. Protected test, lockfile,
config, runner, verification, model-policy and CI paths are rejected. Independent
application/guest patch validation remains mandatory before any later execution.

Issue/repository text is serialized as DATA_ONLY under a static system instruction.
Source UTF-8 digests are checked before sending; captured snapshots/allowed paths
cannot change across awaited requests. Prompt injection is not treated as solved
by that instruction: trusted deterministic code owns paths, frozen hashes,
authorization and verdicts. User issue text/model output cannot select a transport,
change policy, grant API access or declare successful verification.

Input is capped at 64 KiB by task builders and transport configuration; individual
source/issue fields, file counts and paths also have bounds. Catalog caps are
64 KiB/200 models. Outputs are byte/token bounded and schema validated; incomplete,
truncated, wrong-model, secret-bearing or malformed replies fail. Task results
require usage metadata; missing counts are never invented as zero. Usage records
preserve input/output/total and optional cached-input/reasoning subsets, checking
their arithmetic. Raw prompts/responses/provider errors and credentials are not
logged. ECMAScript private credential fields and safe toJSON hide credentials.

## Mandatory no-charge authorization and accounting

Every inference attempt requires a fresh hash/model-bound MetaAccess reservation,
maxChargeUsd=0, ENFORCED_NO_CHARGE and enough remaining authorization lifetime.
Default access denies all attempts. Reused IDs fail. Trusted future controller
must atomically consume permissions in PostgreSQL, prove provider-enforced zero
charge, and record outcomes. This interface is not a completed durable controller
or an attestation verifier. Test doubles are explicitly synthetic; a caller bool
or arbitrary JSON reservation from an HTTP client/model is never acceptable.

The old in-memory maxRequests/estimated-dollar limit is an extra local bound, not
distributed spend authority. Every attempt records RECEIVED, REJECTED or UNCERTAIN
and validated usage or null. Network loss/5xx has unknown provider disposition;
it is never automatically resent. Only an explicit rejected 429 may retry, at most
the configured 0–2 times, honoring Retry-After with bounded exponential jitter
and a total deadline; each retry needs another consumed permission. An interrupted
invocation must not reissue an uncertain inference based on a memory reset.
Controller recovery and duplicate-call reconciliation remain separate work.

Accounting failures/timeouts fail closed instead of returning an unrecorded
success. Recording is bounded to 5 seconds, independently of request cancellation;
unknown records must remain quarantined in durable orchestration. Catalog errors
normalize auth/rate/provider/network/timeout cases without body disclosure and do
not automatically retry. Fixed endpoints reject redirects and arbitrary URLs.

src/scripts/metaSmoke.ts now always reports DISABLED and zero requests, including
when the old META_SMOKE_APPROVED flag is set. It reads no local .env. Normal app
configuration stays ENABLE_META=false. No real provider implementation is connected
to the default deny gate. Later live work requires one explicit approval and proof
of a genuine entitlement that cannot create a charge; otherwise inference stays off.

## Offline verification

RPF-META-002 adds a standalone [durable accounting store](META_ACCOUNTING.md) for
existing quarantined META effects, including unknown usage and lost-ack recovery.
It provides no positive reservation or provider-enforced no-charge entitlement;
the default deny gate and live authorization requirements above remain in force.

Vitest uses injected transports/permissions only. Tests cover catalog selection,
missing models/credentials/approval, request and byte bounds, prompt-injection
fields, source hashes, protected paths, post-await mutation, typed analysis/test/
patch outputs, 429 backoff, uncertain-call no-retry, reservations/replay/expiry,
accounting failure/deadline, safe serialization, malformed usage and old smoke
disablement. These tests are not live Meta or Sandbox evidence. Full suite/lint/
types/build/audits/contract checks and real safe-app regression are recorded in
the canonical board/parent goal ledger with exact commit and command evidence.
