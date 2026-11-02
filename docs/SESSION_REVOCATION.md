# Authoritative session revocation — RPF-SEC-007

RepoProof now disables Better Auth's session cookie cache. PostgreSQL session
records are authoritative on each HTTP/session authorization check. Signed
`session_data` cookies issued by an older release are cleared and cannot keep
a revoked or server-expired session active. Existing valid session tokens and
the established cookie attributes, origins, session lifetimes and wire contracts
remain supported. The cost is an additional bounded database lookup instead of
accepting up to five minutes of cached authorization.

The same authSecurityOptions function configures production and tests. This
protects native get-session/update-user/session-management endpoints and the
shared session resolver for catalog, drafts and issue preview. It does not rely
on frontend state, a caller-supplied freshness flag or voluntary cookie deletion.
The next authoritative check after committed revocation denies access; an
already authorized in-flight operation is not retroactively recalled.

## Reproduction and immutable regression evidence

At baseline 3d5f3e4eac7934a5f8e3f12e55f72b97d07903d1, a separate legacy auth
instance shares the test store/key and mints genuine signed cache cookies.
Three tests demonstrate that another-device revocation, sign-out/replay and
server-side expiry still returned an authenticated session. The accepted
baseline has three genuine assertion failures and a passing typecheck. Earlier
memory-adapter initialization and generic-type failures were setup issues,
retained separately and excluded from reproduction evidence.

The validated test was frozen before the policy change:
`src/lib/authRevocation.test.ts` SHA-256
`07213bbc1055d38e7feba03722f986f1326365acf1d084a7d44473d310776ea7`.
The exact unchanged test passes after the change, including current-session and
unrelated-user positive controls. No fixture test, runner policy or verdict
logic is modified by this ticket.

## Accepted local checks

Node 24.22.2: 14 focused and 738 full tests across 49 files; lint, source and
integration types, normal/Function builds, lint-toolchain and full/production
audits with zero findings passed. Real owned PostgreSQL HTTP gates use the
restricted rpf_product_runtime role in rpf_product_disposable. Source and exported
Function paths both pass genuine legacy-cache cleanup, other-device revocation,
cross-user revocation denial, missing-origin denial, repeated replay, sign-out,
server expiry, wrong-password refusal, password-change revocation and successful
new-password login. Revoked caches also fail native profile updates and all
catalog/draft/issue authorization checks. No public GitHub request is needed.

An independent local observer confirms Run/report/artifact counts are unchanged;
the application role cannot read those tables. Cleanup deletes only the synthetic
auth users created by the gate. External networking is explicitly denied and
attempt count remains zero. No model, Sandbox or fixture execution occurs.

The production frontend proxy/browser regression, existing auth/draft/unavailable
flow, session expiry, deadline retry and synthetic issue-error/cancel/isolation
checks pass against the patched backend. These are local HTTP/SQL browser checks,
not deployed HTTPS or Google OAuth acceptance. Full account UI is the next ticket.
Command/exit/log-hash records are local sec007-* evidence outside Git.

```powershell
npm test -- src/lib/authRevocation.test.ts src/lib/authSecurity.test.ts src/safeMvp/router.test.ts src/safeMvp/drafts.test.ts --maxWorkers=1
node node_modules/typescript/bin/tsc -p tsconfig.sessions.json --noEmit
npm run check
npm run build:function
```

The SQL gate additionally requires the exact owned loopback database/limited role,
synthetic session config and RPF_LOCAL_SESSION_GATE=1. It refuses other targets;
RPF_SESSION_USE_BUNDLE=1 selects the built Function entrypoint. Never run it on
user or cloud data. The frontend harness uses a secret-free built backend copy
and the explicitly approved product test database.

Reference checked November 2, 2026:
[Better Auth session management and revocation/caching](https://better-auth.com/docs/concepts/session-management).
RPF-004 remains IN_PROGRESS; RPF-006A remains DEFERRED.
