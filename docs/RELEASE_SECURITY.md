# Pre-deployment application security — RPF-SEC-006

This is local validation, not a claim of complete security from npm audit.
The deployed HTTPS, proxy and provider boundaries remain external checks.

## Auth throttling and request boundary

Auth uses Better Auth's atomic custom storage interface, backed by a parameterized
PostgreSQL UPSERT. No per-instance memory fallback exists. All environments enable
it. Sign-in permits 5 attempts/60 seconds; signup permits 10/900 seconds; other
auth paths permit 120/60 seconds per canonical client/path. A shared global
600/60-second auth ceiling also bounds new bucket creation. Counts include
successful requests. The database clock sets fixed expiry windows; denied requests
do not extend them. IPv6 uses /64 grouping through Better Auth's IP normalization.
Keys are HMACs under BETTER_AUTH_SECRET; SQL never stores raw path/IP/email keys.
Expired rows are pruned in bounded batches of 100 in foreground. No cron, worker,
Redis subscription or paid service is assumed. Missing table/privileges/outage
denies auth with 429 and a fixed event, never resets to an unshared memory limit.
Apply all four migrations and the updated least-privilege grant list before use.

Before the auth handler, middleware overwrites the internal client-IP header.
On Vercel it accepts only one valid `x-vercel-forwarded-for` address. Off Vercel
it uses the direct socket address and ignores all caller-supplied IP headers.
Missing/malformed platform identity fails with 503. Do not set VERCEL=1 on an
arbitrary publicly reachable host or trust its callers to supply platform headers.
An external proxy may collapse many users to one address: do not trust a fabricated
original-IP header to work around it. Test actual web-to-api rewrites, spoofed
headers and shared-client behavior on the approved Vercel projects. Conservative
shared throttling is appropriate for the small closed SAFE MVP; larger usage needs
a separately reviewed identity/proxy design and quota review.

Auth mutating requests require JSON, reject compression, cap actual streamed bytes
at 16 KiB and cap body collection at 5 seconds. Both declared and chunked overflow
return fixed 413; malformed/primitive JSON returns fixed 400; unsupported media or
encoding returns 415. Pinned Better Call 1.4.4 explicitly supports a consumed parsed
JSON body; actual Better Auth signup/login/session tests verify this integration.
The v1 JSON parser retains its existing 100 KiB limit and fixed typed errors.
Auth request parsing happens before credential hashing/database mutation.

Default Better Auth logs are replaced by a fixed `auth_error` event; rate-store
failures use `auth_rate_store_unavailable`. Middleware errors never echo the body.
No headers/cookies/passwords/query text/connection URLs/provider exceptions are
logged. Health remains public; readiness returns only ready/unavailable. Debug
request/SQL logging must remain off in deployment.

## Verified local scope

- Exact origins/CSRF, host-only HttpOnly/Secure/Lax cookie configuration and no-store.
- Real restricted-role auth, draft persistence and two-user authorization.
- Twenty concurrent SQL consumptions admit exactly five; expiry permits retry.
- Five actual failed password logins then 429, including spoofed IP headers.
- Actual bounded-body signup/session, logout invalidation and safe JSON errors.
- Oversized/chunked/compressed/malformed bodies and stalled upload rejection.
- HMAC parameterization, invalid-rule rejection and fail-closed store errors.
- Candidate/pinned contract compatibility and dependency audits as separate gates.

Existing frozen fixtures, evidence constraints and deterministic policy are not
changed. `/runs` remains unavailable and creates no evidence. The separate Sandbox
control role gets no API role privileges. Production database ownership credentials
must not enter Vercel runtime, logs or the Sandbox.

Official references checked November 1, 2026:
[Vercel request headers](https://vercel.com/docs/headers/request-headers),
[Better Auth throttling](https://better-auth.com/docs/concepts/rate-limit),
[Better Auth options](https://better-auth.com/docs/reference/options).
Implementation is checked against installed Better Auth 1.7.14/Better Call 1.4.4
source and types; an unpinned future SDK behavior is not assumed.
