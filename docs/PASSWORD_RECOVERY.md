# Password recovery — RPF-AUTH-002BE

This ticket completes the local backend recovery surface. Frontend forms are a
separate consumer ticket. It does not enable email verification, OAuth, external
mail delivery or cloud deployment. Existing email sign-in and signup still work
without SMTP. `ENABLE_SMTP=false` remains the default.

## Supported operations

- `GET /api/v1/auth-capabilities`: public `{passwordReset:{enabled:boolean}}`.
  Configuration availability only, without provider details, account membership
  or a delivery guarantee. No query accepted, no database/provider call, no-store.
- `POST /api/auth/request-password-reset`: native bounded JSON `{email}` and a
  trusted Origin. Optional `redirectTo` must exactly match the configured
  `FRONTEND_URL/reset-password`. Registered and unknown addresses receive the
  same generic acknowledgement; no user ID, token or delivery status is returned.
- `POST /api/auth/reset-password`: native JSON `{token,newPassword}` and trusted
  Origin, no query. Password length 8–128; token is 24 random alphanumeric bytes.
  Success returns `{status:true}` and creates no session. Sign in again.

The exported strict schemas and `auth-recovery.openapi.json` describe these
operations. Framework errors remain separate from the v1 error envelope. Missing
SMTP disables request/completion/callback with 503. Cross-origin redirects are
rejected by native origin checks; other disallowed callbacks produce 400.

Mail uses the exact configured frontend origin and
`/reset-password#token=...`. The token fragment does not enter HTTP request URLs
or Referer headers. The consumer must read it into memory, remove the fragment
immediately, avoid browser storage/analytics, and send it only in a JSON body.
The native GET URL-token callback is unsupported and rejected; its generated
URL is never mailed. No user-controlled return URL, name, HTML or attachment
enters the message.

## Token, session and quota guarantees

Better Auth 1.7.14 generates and consumes its native reset token. The reset
namespace uses SHA-256 identifiers in PostgreSQL, with a 15-minute lifetime.
Other verification namespaces keep their existing representation. A token is
consumed once. Concurrent attempts produce exactly one successful password.
Prisma transactions are enabled so token consumption, all-session revocation
and the password write commit together. A forced SQL permission failure proves
all three roll back and the same token can safely retry. Successful reset revokes
all devices immediately under the existing authoritative DB session policy;
another owner's account/session remains valid. Multiple separately issued
unexpired links each retain their native single-use lifetime.

Shared PostgreSQL/HMAC quotas apply to registered and unknown email addresses:

- Request: 5/client/15 minutes; 3/address/15 minutes; 30 global/minute.
- Completion: 10/client/5 minutes, plus the existing global auth ceiling.
- Storage errors deny recovery; keys contain neither plaintext email nor token.
- Existing bounded 16 KiB/5-second auth bodies and trusted-IP/CSRF/origin guards
  remain active. Callers cannot supply the internal IP header.

The capability read is constant public configuration with no user lookup or
provider effect, so it does not consume the mail quota. Mail delivery runs outside
request timing. Vercel runtime uses `waitUntil`; local tests wait explicitly for
their bounded sink. There is no durable external-mail retry/outbox guarantee.

## SMTP and failure safety

Use an explicitly approved SMTP account through the existing `ENABLE_SMTP` and
`EMAIL_SENDER_SMTP_*` configuration. This work performs no external delivery and
does not establish an external provider's free entitlement. Sender is one plain
email address. Port 465 defaults to implicit TLS; other ports require STARTTLS.
`EMAIL_SENDER_SMTP_SECURE` can explicitly select implicit TLS for another port.
Certificate verification and TLS 1.2 minimum cannot be disabled through app
configuration. Connect, greeting, DNS and socket inactivity have bounded waits.
No connection pool, raw protocol logging, file access or URL attachment access.

Nodemailer is pinned to 10.3.1; its Node24 runtime and pinned type package pass
the gates. SMTP failures are caught by the auth background task and retain only
a fixed event. Native Better Call's raw fallback logger is bypassed for unexpected
exceptions: a narrow HTTP boundary emits `auth_error` and a fixed 500 response.
Normal native validation, origin and quota API errors preserve their behavior.
SQL details, addresses, reset tokens and SMTP secrets do not reach logs/responses.

## Observed local verification

### Synthetic transaction fixture correction (RPF-TEST-006BE)

The installed Better Auth 1.7.14 memory adapter clones transaction snapshots
and explicitly merges same-row writes with last-writer-wins semantics. It does
not implement PostgreSQL's concurrency contract. A later full-suite run exposed
this fixture limitation: both concurrent reset requests returned 200.

The unit fixture now serializes its memory-adapter transactions. All six tests
and every original concurrent replay assertion remain unchanged, including one
200, one 400, successful login with the winning password and rejection of the
losing password. The unchanged concurrent-test block has SHA-256
`9cb6369c7f9a392895dfcae8206614c7b0b5d4ba654fccf673f3e0c5035c33ae`.
This synthetic fixture establishes no production locking or concurrency proof.
The existing restricted PostgreSQL source/Function integration observations
remain the separate evidence for actual transaction rollback and token reuse.

A clean tracked-source copy passes six focused tests and 780 full tests in 56
files, lint, types, production build, lint-toolchain checks and full/production
audits with zero findings. Production authentication code, dependencies and
contracts are unchanged. The failed run and correction are retained under
`output/full-product-2026-11-02/evidence/harmless-full-quality.*` and
`recovery-fixture-*`. Uncommitted harmless Sandbox preparation is excluded from
this ticket and its tested copy.

Node 24.22.2 clean lockfile install; 771 full tests in 54 files; lint, source and
integration types, normal/Function builds, lint-toolchain checks and full/prod
audits (zero findings) pass. Ten new focused cases are included in that full count.
Initial new-test status/type errors and failed integration observations are
retained; final passing evidence is not a sum of historical runs.

The original temporary DB container stopped with Docker; its checkout and
historical command evidence remain intact. A new separate owned PostgreSQL 16
container `rpf-recovery-20261103` binds only `127.0.0.1:35441`, with fixed image
digest, local resource bounds and disposable tmpfs. It is test storage, not
Sandbox isolation evidence. All eleven existing migrations deploy successfully.
`rpf_recovery_runtime` uses the reviewed limited grants; raw run/evidence reads
are denied. No migration or runtime grant expansion was needed.

Actual source and exported Function HTTP gates use a real certificate-verified,
authenticated TLS sink on loopback. Three messages per successful gate remain
only in memory. They prove unknown-address acknowledgement, hash/expiry,
single-use/concurrency, real SQL rollback, all-device revocation, unrelated-user
isolation, actual shared SQL quotas, safe errors and SMTP rejection. Each gate
uses a fresh synthetic client through a real loopback socket and then exhausts
that client's quota; no forwarded-IP spoof, limit override, bucket deletion or
clock change is used. PostgreSQL UTC expiry is measured independently in SQL,
avoiding the observer driver's local-time parser for timestamp-without-time-zone.

Run/report/artifact counts remain 0/0/0. No external email, fixture execution,
Meta inference, Sandbox, cloud write, billing change or spend occurred. Evidence:
`output/full-product-2026-11-02/evidence/recovery-*`. Deployed delivery/Function
request lifetime and user-facing recovery are not claimed by this backend ticket.
