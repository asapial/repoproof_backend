# RepoProof $0 deployment package — RPF-REL-001

Prepared locally only. No push, deployment, cloud creation or paid action is authorized.
Final manifest/report: parent output/predeployment-2026-11-01. Use its exact candidate
SHAs and artifact hashes, not old primary checkouts or arbitrary HEAD. Two repositories.

## Eligibility and cost

Vercel Hobby is personal/noncommercial. Owner confirmation is required. A commercial
RepoProof service is not eligible merely because staging is small. If commercial,
keep the demo local until a compliant hosting choice is approved. Do not upgrade or
silently change architecture. Hobby cannot link organization-owned Git repositories;
a separately approved CLI deployment of exact local source may avoid that Git-link
restriction, subject to actual account eligibility. No remote Git publication now.

Published limits checked November 1, 2026:

| Service | Free allowance relevant here | Stop / guard |
| --- | --- | --- |
| Vercel Hobby, shared web/API account | 4 active CPU hours, 360 GB-hours memory, 1M Function invocations, 100 GB fast transfer, 10 GB origin transfer, 1M CDN requests; 100 deployments/day; 100 MB CLI source upload | Hard usage caps, no paid overage purchase. Pause tests at 75%, stop at 90%; inspect both projects together. |
| Neon Free | 100 CU-hours/project/month, 1 GB/project and 20 GB total storage, 5 GB/project/month egress, 10 branches/project | Compute/egress exhaustion suspends compute; storage growth fails at cap. Small compute, scale-to-zero, no keepalive/replicas. |
| Neon recovery | 6-hour history capped at 1 GB changes, one manual snapshot, no scheduled Free backup | Encrypted external manual pg_dump and restore rehearsal in separate empty DB. |
| Sandbox Hobby | 5 active CPU hours, 420 GB-hours memory, 5,000 creations, 20 GB transfer/month; max session 45 min | Provider pauses at cap. App disabled. Later approved smoke: one-shot, 1 CPU/2 GiB/30 seconds, no persistence/network. |

Sources: [pricing](https://vercel.com/pricing), [Hobby](https://vercel.com/docs/plans/hobby),
[limits](https://vercel.com/docs/limits), [Neon](https://neon.com/docs/introduction/plans),
[Sandbox](https://vercel.com/docs/sandbox/pricing). Recheck actual entitlements/balances
before approval. Published allowances are not verified account balances. Budget $0:
no paid models, subscriptions, domains, registry pushes, auto-upgrades or paid monitoring.

## Consolidated credential/environment checklist

Use provider secret settings or approved secret manager. Never send values in chat,
Git, public variables, command arguments or logs. Names below are case-sensitive.

| Group | Item / names | Destination / requirement |
| --- | --- | --- |
| A user access | Eligible Vercel Hobby owner login, project IDs/region; Neon Free owner login, project/branch/database and migration owner access | Provider UI/operator only. Confirm staging access policy and $0 cap. No token needed for package review. |
| A runtime DB | DATABASE_URL | API only: pooled Neon URL, limited SQL-created runtime role, verified TLS; never owner/admin. URL-encode password. |
| A migration DB | DIRECT_URL | Direct Neon owner URL, operator migration shell only; never API/frontend runtime. |
| B local generated | BETTER_AUTH_SECRET | Independent CSPRNG secret, at least 32 characters, API only. Generate/store in password manager or local CSPRNG without chat echo. Rotation invalidates sessions/HMAC rate keys. |
| B local generated | Runtime-role password; later separate Sandbox control-role password | Independent random passwords, never migration-owner credential. No real secret generated/inserted by this task. |
| C API config | NODE_ENV=production; BETTER_AUTH_URL; FRONTEND_URL | Both URLs equal exact web HTTPS provider origin in proxy mode: no path/query/hash/wildcard/trailing slash. Function needs no PORT. |
| C web server | REPOPROOF_API_ORIGIN | Exact HTTPS API provider origin, web build/runtime. Rebuild to change target. Never user-controlled. |
| C omit direct mode | NEXT_PUBLIC_API_BASE_URL | Leave unset; client uses /api. Never mix proxy/direct config or expose secrets. |
| C optional tuning | BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN=604800; BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE=86400 | API defaults, positive bounded seconds; update age below expiry. Node engines 24.x; VERCEL is platform-owned. |
| D disabled | ENABLE_OPENROUTER=false; ENABLE_META=false; ENABLE_SMTP=false; ENABLE_GOOGLE_OAUTH=false; ENABLE_CLOUDINARY=false; ENABLE_LEGACY_JWT=false | API; keep debug request/SQL logging off. No unused provider keys required. |
| D omit keys | OpenRouter_API_KEY; MODEL_API_KEY; EMAIL_SENDER_SMTP_USER/PASS/HOST/PORT/FROM; GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL; CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET; ACCESS_TOKEN_SECRET; REFRESH_TOKEN_SECRET; ACCESS_TOKEN_EXPIRES_IN; REFRESH_TOKEN_EXPIRES_IN | Omit while disabled. Provider registration/live calls/paid use need separate approval. |
| E Sandbox off | SANDBOX_SMOKE_ENABLED=false | Every normal deployment. No public execution route; /runs stays 503. |
| E later operator only | SANDBOX_TOKEN; SANDBOX_TEAM_ID; SANDBOX_PROJECT_ID; SANDBOX_ADMIN_USER_ID; SANDBOX_IMAGE; SANDBOX_NODE_VERSION; SANDBOX_CONTROL_DATABASE_URL | Not needed for SAFE MVP. Never frontend/ordinary API. Follow SANDBOX_PREPARATION.md: genuine admin, immutable VCR image, fresh one-shot Hobby quota row. Managed-image digest avoids custom registry provisioning. No live smoke authorized. |

Expanded optional credential names (all omitted now):
OpenRouter_API_KEY, MODEL_API_KEY, EMAIL_SENDER_SMTP_USER, EMAIL_SENDER_SMTP_PASS,
EMAIL_SENDER_SMTP_HOST, EMAIL_SENDER_SMTP_PORT, EMAIL_SENDER_SMTP_FROM,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL,
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET, ACCESS_TOKEN_EXPIRES_IN,
REFRESH_TOKEN_EXPIRES_IN. The flags validate enabled credentials, but enabling
mail/OAuth in configuration alone does not implement an endpoint/provider flow.

## Two-project deployment procedure — after explicit approval only

1. Identify final manifest SHAs and approved empty staging DB. Create repoproof-api
   from backend root and repoproof-web from frontend root; no parent monorepo.
   Use Node24 and committed vercel.json: npm ci --ignore-scripts, explicit build.
   src/app.ts exports without listening; build:vercel generates Prisma.
2. Reserve free web/API HTTPS subdomains, set exact auth/proxy origins, align
   API/Neon regions. No invented live domain or production HTTP. Do not continuously
   probe readiness: it prevents Neon scale-to-zero and consumes free quota.
3. Review access policy. If available, protect the web preview with Vercel auth.
   Current rewrite needs an API reachable without provider login. Protecting that
   API separately requires a reviewed server-only protection-bypass path, which
   is not implemented/assumed. App sessions protect private data. If required
   staging protection cannot be met on Free, stop; do not expose a supposedly
   private service or weaken auth. Synthetic demo data only.
4. Back up existing data, hash archive and rehearse restore in a separate empty
   approved target. See NEON_READINESS.md. With DIRECT_URL only in operator shell,
   run npx --no-install prisma migrate deploy, migrate status, repeat deploy.
   Four tracked migrations required. Never migrate dev/reset/db push in staging.
5. Create limited runtime role through SQL; console-created Neon roles may inherit
   neon_superuser. Apply deploy/runtime-grants.sql with exact approved_database and
   runtime_role psql variables after migrations. Verify no CREATE, migration,
   evidence/Run access or owner assumption. API gets pooled limited DATABASE_URL.
   Keep Sandbox administrative schema uninstalled. Never reuse local trust URLs.
6. Deploy API, then build/deploy web with exact upstream. Verify actual Vercel
   export/Node patch/tracing/native dependencies/250 MB Function size and
   maxDuration=15. API .vercelignore excludes environment, fixtures, SQL, docs,
   tests, harnesses and local bundles. Never upload node_modules/.env. Local
   build:function is a simulation, not provider tracing.
7. Check /healthz then one /readyz; keep end-user writes closed until external
   checks pass. Record immutable provider deployment IDs, source SHAs and
   environment names without values. Preview success is not production approval.

## Backup and rollback

Use encrypted manual pg_dump, not reliance on Free short history alone. Restore
only to a new empty approved target and compare constraints/triggers/migrations
and synthetic tests before switching connections. Never overwrite populated data,
reset a branch, rewrite migration history or run destructive down migrations.
App rollback uses known compatible provider artifacts/exact Git SHAs after approval;
the additive auth-rate table can remain. Preserve prior deployment and DB backup.

## External acceptance gates

- Owner confirms personal/noncommercial eligibility, account balances, regions,
  access policy, exact targets and permitted $0 actions.
- Actual Vercel build/export/tracing/duration and Neon TLS/pooling/least-privilege
  four migrations/status/restore succeed.
- Web HTTPS proxy preserves host-only Secure/HttpOnly/Lax cookies and no-store;
  two users cannot read/write each other's draft.
- Evil/missing Origin fails; spoofed IP headers cannot evade login 429; actual
  proxy/shared-IP behavior is understood. Logs expose no credentials.
- Signup/login/session/reload/logout/draft save/delete/mobile pass; expired 401
  clears private UI; stalled requests recover with timeout/retry.
- No real Run/report/verdict; /runs stays RUNNER_UNAVAILABLE. Providers stay off.
  No Sandbox starts during deployment acceptance. Later separate approval must
  prove deny-all/runtime/resources/TTL/cleanup, no app secrets, durable control,
  isolation/provenance. RPF-004 IN_PROGRESS; RPF-006A DEFERRED.

Final approval must identify candidates and actions: provision Free resources,
install secrets, migrate named empty staging DB, deploy two projects, synthetic
HTTPS checks. It never implies Git push, paid upgrade, production-data writes,
model calls, arbitrary repositories or live Sandbox execution.
