# Disabled Vercel Sandbox preparation — RPF-SBX-001

No live sandbox has been created. Offline SDK tests and a real local PostgreSQL
control test do not establish isolation. RPF-004 stays IN_PROGRESS; RPF-006A stays
DEFERRED. `/api/v1/runs` remains 503 RUNNER_UNAVAILABLE. No code here creates a
Run, report, verification verdict, snapshot, drive, patch, or user repository clone.

## Prepared boundary

`src/sandbox/admin.ts` exports a server-internal smoke harness. It is deliberately
not registered on Express and is not included by the app entrypoint. Keep
`SANDBOX_SMOKE_ENABLED=false` on both Vercel projects. Never call this through an
unapproved public route or use request-supplied roles, IDs, environment, commands,
filesystem paths or repositories as authorization. The harness resolves a genuine
Better Auth session, requires the operator-configured admin user ID and exact
frontend Origin. It fails closed before execution on missing configuration,
session failure, fixture mismatch or missing/expired/exhausted shared permission.

The provider uses pinned SDK 3.9.1. It sends exactly one create attempt through a
guarded transport, including when the SDK would retry a 5xx or uncertain network
response. Creation uses an operator-approved immutable VCR image digest, 1 vCPU
(provider allocation: 2 GiB), 30-second lifetime, deny-all egress, persistent=false,
no exposed ports, no mounts/source/snapshot, and empty command/default environment.
Only the explicit SDK token/project/team reach the provider control plane; no app
secret, database URL or auth cookie is sent into the VM. Provider image contents,
actual non-root behavior, egress blocking and destruction still need live proof.

Three fixed files from the owned discount-bug fixture are hash-checked against
pin 1066351c5b07bed024775a16af9151048a9316b2. Symlinks, extra files and changed
bytes fail. Only validated byte copies upload. Host code only reads/hashes these
files; it never imports or executes them. Fixed remote commands check the exact
Node 24 patch version, hashes before/after, issue exit 1 and regression exit 0.
This is a transport smoke on a newly approved image, not a reinterpretation of
the historical Node 20 fixture evidence or an assertion/verdict proof.

Commands have provider-enforced 5-second limits; the operation has a 20-second
deadline and a separate 5-second cleanup deadline. Cancellation and every error
attempt stop. Late create results also attempt stop. Output beyond 16 KiB aborts;
all raw stdout/stderr and provider exceptions are discarded. Logs contain only
fixed event/status enums, cleanup boolean and command count. No model output is
trusted. A failed or unknown cleanup returns CLEANUP_UNCONFIRMED. No networked
system can promise acknowledged cleanup during a partition: the one-shot control
stays consumed, the provider TTL bounds the session, and an operator must reconcile
actual provider inventory before any future permission.

## Shared one-shot permission and $0 gate

`deploy/sandbox-control.sql` is a separate administrative schema, outside product
Prisma migrations. It creates no row and grants nothing to PUBLIC or the app
runtime role. Do not install it in an existing database without reviewing the
target and owner. A separate non-owner control role may receive schema USAGE,
table SELECT, and column UPDATE(state, consumed_at, cleanup_confirmed) only.
Never grant INSERT, DELETE, TRUNCATE, ownership or arbitrary schema rights. Never
give this role to the frontend or ordinary API runtime. The transition trigger
prevents rearming a consumed row. Only an approved operator can establish a new
permission through a separately reviewed administrative change after reconciliation.

Before a live smoke, an operator must verify the actual account is Hobby,
noncommercial eligibility, no paid usage/upgrade, current provider quotas across
all projects and no other Sandbox workloads. Record that observation in the single
row, bound to the exact admin/project/team/image/runtime. It must expire within
5 minutes and include at least 60 active CPU seconds, 120 GiB-seconds memory,
2 creations and 2 MiB transfer remaining. These are conservative margins above
the 30-second/one-create/2-GiB small smoke. Null/unknown/zero/stale values deny.
The adapter atomically consumes the single row before create. Across processes
only one claim can win. Completion never returns permission or quota. A killed
process cannot reopen the gate. Do not substitute a per-instance memory counter
or an unverified client-provided quota estimate. This is operator-attested quota,
not an automated provider billing API or permission to run now.

Official sources checked November 1, 2026:
[SDK](https://vercel.com/docs/sandbox/sdk-reference),
[quotas](https://vercel.com/docs/sandbox/pricing),
[persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence).
Defaults are persistent and allow-all; this adapter explicitly overrides both.
Hobby currently includes 5 active CPU hours/month, 420 GiB-hours memory/month,
5,000 creations/month and 20 GB transfer/month, and pauses creation at the cap.
No Pro or paid fallback is permitted. Recheck these entitlements on the actual
account immediately before approval. Public quota changes cannot auto-enable code.

## Configuration for a later separately approved smoke

Keep provider credentials outside chat/logs/Git and outside the ordinary API
deployment. The server-internal operator context would require:

- SANDBOX_SMOKE_ENABLED=true (only after separate cloud approval)
- SANDBOX_ADMIN_USER_ID (existing authenticated admin chosen by operator)
- SANDBOX_TOKEN, SANDBOX_TEAM_ID, SANDBOX_PROJECT_ID (scoped provider access)
- SANDBOX_IMAGE (approved VCR reference ending @sha256 plus 64 lowercase hex)
- SANDBOX_NODE_VERSION (exact v24.x.y present in that image)
- SANDBOX_CONTROL_DATABASE_URL (separate restricted control role, verified TLS)
- Existing core auth/origin configuration, plus the approved fresh control row.

The SAFE app deployment excludes fixtures and administrative SQL. A later smoke
needs a separately reviewed operator executor with fixture bytes available and
enough foreground lifetime to await cleanup. Vercel request termination and a
fire-and-forget callback are not a durable runner. Do not expose this harness or
enable /runs until that integration and real isolation/provenance gates pass.

## Local evidence

`vitest run src/sandbox --maxWorkers=1` tests SDK calls using mocked transport;
no fixture code or live API executes. It covers config/identity/origin rejection,
fixture hashes, quota failures, exact create/command options, timeouts, cancellation,
late create cleanup, output bounds, error redaction, SDK retries and uncertain stop.
`integration/rpfsbx001-control.ts` uses only the specifically guarded local
rpf012s_disposable database. It requires an empty administrative control table,
tests real 8-client atomic claiming, stale/zero quota and no-rearm, then leaves
the synthetic consumed row in place. It refuses to overwrite prior evidence.
