# Optional email ownership confirmation — RPF-AUTH-003BE

This backend ticket adds actual native email verification with strict app-owned
JSON routes. The consumer page is a separate frontend ticket. It does not verify
code, execute a run or change the deterministic verdict policy.

## Configuration and compatibility

`ENABLE_EMAIL_VERIFICATION=false` is the default. Enabling it requires explicit
`ENABLE_SMTP=true` and the existing approved TLS SMTP configuration. No external
provider entitlement or inbox delivery is proven here; all delivery tests use a
local authenticated certificate-verified sink. Password recovery keeps its
independent availability. Its seven existing frontend contracts and current
consumer remain compatible; no field is added to the strict auth-capabilities
response and no dependency/lockfile change is needed.

When enabled, native signup sends a verification message asynchronously through
the existing safe background/`waitUntil` integration. Native sign-in remains
compatible; email verification does not become a new prerequisite for the
existing preview APIs. No verification mail is sent on sign-in. Future execution
or provider policies retain their own explicit prerequisites.

## Actual supported routes

Every route is under `/api/v1/email-verification`, no-store, query-free and uses
the existing strict v1 error envelope. Bodies are bounded to 16 KiB and five
seconds, with JSON-only/uncompressed/object parsing and server-established IP.
The shared auth guard now supports a v1 error adapter; legacy auth responses are
unchanged. Writes require the exact configured frontend Origin, even without a
cookie.

- `GET /api/v1/email-verification`: public `{enabled:boolean}` configuration.
- `GET /api/v1/email-verification/account`: authoritative current session only;
  returns `{email,verified,enabled}` without user/session IDs or credentials.
- `POST /api/v1/email-verification/request`: authenticated current owner, strict
  empty JSON object. Recipient comes only from that session. Caller-selected
  email/user/callback is rejected. Acknowledges with 202 `{status:true}`; an
  already verified account is idempotent and sends nothing.
- `POST /api/v1/email-verification/confirm`: anonymous signed capability in a
  JSON `{token}` body; returns only `{status:true}`. Invalid/expired/scope failures
  are 400; infrastructure/write failures are a safe 503 and allow a valid retry.

Shared PostgreSQL/HMAC admission: account reads 60/user/minute and 300 global;
request/confirm 10/IP/five minutes and 60 global/minute per action; actual delivery
three/user/15 minutes and 30 global/minute. Storage failures fail closed. Delivery
limits also apply to automatic signup mail. No process-memory fallback or
plaintext identity/token rate key exists. The public capability does no user,
database or provider lookup.

Strict schemas live in `src/contracts/emailVerification.ts`; generated OpenAPI
describes only these four operations. Native `/api/auth/send-verification-email`
and `/api/auth/verify-email` HTTP paths are disabled, including trailing slashes.
Their trusted server API methods remain in use behind this wrapper.

## Capability and native authority

Better Auth 1.7.14 issues the original HS256 email token. The delivery callback
checks its exact email/iat/exp payload and adds the explicit purpose
`repoproof-email-verification.v1` without extending its lifetime. Completion
requires this exact purpose, signature/algorithm and payload, no future issued
time, and at most 15 minutes. Raw native tokens, other-purpose/algorithm tokens
and native email-change payloads are rejected before dispatch to native auth.
Native auth performs the actual `emailVerified` database write.

Mail is plain text and points only to
`FRONTEND_URL/verify-email#token=...`. No token query/path, caller return URL,
HTML, attachment or account name is mailed. The future consumer must remove
the fragment immediately and retain the token only in memory until completion.
Token/email/provider diagnostics never enter public errors or application logs.

Confirmation is **idempotent until expiry**, not a single-use password-reset
operation. It changes only email ownership state. Automatic sign-in is disabled;
the wrapper discards native output and never forwards a session cookie. It does
not change email, password, another account, approval, run state or verdict.
Authoritative session reads observe the verified flag immediately. The existing
password-reset single-use/atomic-all-session-revocation guarantees remain separate.

## Observed evidence

Node24 clean lockfile install; 14 focused tests (nine new plus five existing body
guard tests), 780 full tests in 56 files, lint/source and integration types,
normal/Function builds, toolchain and full/production audits with zero findings.
An initial native return-type error is retained; explicit successful native
result checking now passes. Existing frontend seven-file contract parity passes
against its pinned 0672347794e7f276a5ae50b157e684404171ce98 and current source.

A separate owned `rpf_verification_disposable` on the existing local test
container/loopback 35441 deploys all eleven migrations. Reviewed limited runtime
grants suffice; raw run/evidence access stays denied. Actual source and exported
Function HTTP plus local authenticated TLS capture four messages per gate:
signup A/B and two own-account resends. Delivery/user and confirmation/IP limits
are genuinely exhausted. Distinct synthetic loopback clients are real sockets;
no header spoof, bucket deletion, clock change or limit override is used.

Independent SQL observes own/unrelated state, unchanged passwords/session counts,
no anonymous login, safe failed-write retry and idempotent confirmation. Correctly
signed expired/wrong-scope/algorithm cases are explicit synthetic negatives,
not a claim that fifteen minutes elapsed. Native query routes are actually denied.
No token persists in the native verification table. Run/report/artifact counts
stay 0/0/0. No external email, provider, billing or fixture execution occurs.

The existing committed recovery frontend is also tested against this new backend
with the new verification flag left off. Its result is recorded separately in
`verification-recovery-compatibility`; no frontend source is changed by this
backend ticket. Evidence: output/full-product-2026-11-02/evidence/verification-*.
Deployed request lifetime, inbox delivery and the verification UI remain separate.
