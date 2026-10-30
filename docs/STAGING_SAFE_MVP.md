# SAFE MVP staging preparation (not deployed)

Status: **not approved or ready for deployment**. This is a provider-neutral plan. The local checks do not prove real TLS termination, DNS, host security, browser cookie behavior on the selected domains, deployed authorization, backups or rollback. No provider, infrastructure, spending, push or deployment has been approved. RPF-004 remains IN_PROGRESS; RPF-006A remains DEFERRED. No fixture execution or verdict is available.

## Release inputs and hosting requirements

- Backend: use the reviewed RPF-STG-001 commit containing this file and its board history. Frontend: `9e490e5e8f23d7631317590b6c41bb2ba6f947a3`. Preserve the backend-owned frontend contract pin `2571cfc7f19e8a0ab06d6e1fba10a5fdaeee0ce8`. Select exact immutable commit SHAs and record artifact hashes before any deployment.
- Obtain explicit approval for provider, region, cost limit, domains, operator access, staging access policy and database. Use a private or access-restricted staging environment, separate from production, with independent credentials and synthetic test accounts. No fixtures, code from users or paid model calls may run.
- Node must satisfy Prisma's `^20.19 || ^22.12 || >=24.0`, Vite's `^20.19.0 || >=22.12.0` and Next's minimum. Local checks used Node 25.6.1; the chosen supported host version still requires its own checks. Provide a PostgreSQL instance reachable only by the application and migration job, TLS as required by the provider, persistent storage, backups and least-privilege separate migration/runtime roles. PostgreSQL 16 was used for local disposable tests.
- Provide HTTPS for both exact origins; prefer same-site staging subdomains to reduce third-party-cookie failures. Backend cookies in production are `Secure`, `HttpOnly`, `SameSite=None`, host-only. Confirm browser behavior under the chosen domains and privacy policies. `FRONTEND_URL` must be the frontend origin and `BETTER_AUTH_URL` the public backend origin. The frontend must be built with `NEXT_PUBLIC_API_BASE_URL` set to that backend origin. All three are exact origins without credentials, paths, queries or fragments. `NEXT_PUBLIC_*` is public and must never contain a secret.
- Put the backend behind an HTTPS reverse proxy with restricted inbound access, a request-size limit, reviewed access logging and rate limiting, and ensure the backend port is not directly public. `server.ts` listens without an explicit host; enforce network isolation at the hosting layer. `/` reports process information but does not establish continuing database readiness. Validate readiness/alerts and avoid logging cookies, passwords, authorization headers, database URLs or secrets. Do not treat a zero npm-audit result as a security audit.

## Backend environment

Supply values through the approved host secret manager; do not put real values in Git, shell history, screenshots or frontend configuration. These names are currently mandatory at startup, even when a feature is unused:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT`, `DATABASE_URL` | Set `NODE_ENV=production`; host-assigned port and isolated staging PostgreSQL URL. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL` | Independent high-entropy staging session secret and the exact HTTPS origins. |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `ACCESS_TOKEN_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` | Independent staging token secrets and explicit lifetimes. |
| `BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN`, `BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE` | Explicit session settings required by the current environment loader. Verify effective Better Auth configuration before relying on them. |
| `EMAIL_SENDER_SMTP_USER`, `EMAIL_SENDER_SMTP_PASS`, `EMAIL_SENDER_SMTP_HOST`, `EMAIL_SENDER_SMTP_PORT`, `EMAIL_SENDER_SMTP_FROM` | Required by loader; actual usage must be reviewed and access bounded. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Required by loader; do not claim OAuth is verified. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required by loader; no upload behavior is verified. |
| `OpenRouter_API_KEY` | Required by loader despite no model calls in this SAFE MVP flow. Do not use a fake credential for staging or enable paid access without approval. |

The unnecessarily broad startup requirements are a staging blocker until the owner approves appropriately scoped staging values or the application is changed and retested to make unused integrations optional. Provisioning any credential or paid provider access requires separate authorization.

## Build and migration procedure (proposal only)

After provider, access, costs, secrets and deployment are explicitly approved:

1. Check out the immutable backend and frontend commits in separate clean build environments. Run `npm ci --ignore-scripts`, tests, lint, typecheck and `npm audit` in each. Set `REPOPROOF_BACKEND` to the verified backend checkout for frontend `npm run contracts:check`. Resolve advisories rather than suppressing them.
2. Backend build: run `npm run build` with build tooling installed. It generates Prisma client and `api/server.js`; retain this exact build artifact. Runtime requires production dependencies including `dotenv`; in a clean runtime artifact directory use the matching package files and `npm ci --omit=dev --ignore-scripts`, then run `node api/server.js`. Do not run `npm run test:ai` or seeding scripts. The production bundle was tested locally with a loopback test-only binding and synthetic environment; the chosen runtime platform must be verified.
3. Frontend build: inject the approved public HTTPS backend origin as `NEXT_PUBLIC_API_BASE_URL`, run `npm run build`, and run `npm run start` using the chosen host's approved port binding. Do not reuse the local HTTP test build. Verify artifact hashes.
4. Before migration, verify the isolated staging database identity and take a restorable backup. Using a dedicated migration job with the exact matching schema and approved `DATABASE_URL`, run `npx prisma migrate status`, then `npx prisma migrate deploy`, then `npx prisma migrate status` again. Do not use `migrate dev`, reset, seed, or target an existing development or production database. Prisma CLI is a development dependency, so the migration job needs the build-tool dependency set.
5. Start backend behind the restricted proxy, then frontend. Verify TLS, exact CORS and CSRF origins, secure cookies and private access. With designated synthetic staging users, verify login/logout, approved catalog, one-user draft save/restore/delete and authorization across two users, invalid requests, and `RUNNER_UNAVAILABLE` 503. Confirm no run/evidence rows or jobs are created. This is future staging acceptance, not completed evidence.

## Rollback and limitations

Preserve the prior immutable backend/frontend artifacts, configurations, secret references and tested restore point before release. On failure, remove staging traffic and restore the previous application artifacts and compatible secret references. Do not assume Prisma migrations reverse automatically: assess schema compatibility and restore the verified staging database backup only after the owner approves the data-loss implications. Recheck login, draft behavior, authorization, health, logs and zero execution after rollback.

Unresolved: independent runner isolation, execution provenance, run lifecycle, report/evidence endpoints, the RPF-001C live lifecycle contract, deployed HTTPS/browser behavior, integration-specific credential requirements, production-level rate limiting and provider operations. Staging of the limited draft/catalog feature does not establish production readiness or a verification verdict.
