# Prepared repoproof-api Vercel project

RPF-VCL-001BE is local preparation, not deployment. The chosen target is an
independent `repoproof-api` project on Vercel Hobby with Express Functions and
Node 24.x. No project, account setting, domain, remote workflow or paid service
has been created or changed.

`src/app.ts` directly imports Express and exports the configured application.
Import does not connect Prisma or start an HTTP listener. `src/server.ts`
remains the local development/runtime entrypoint and closes HTTP connections
and Prisma on SIGINT/SIGTERM. `PORT` is optional for Function imports, defaults
to 5000 locally and rejects invalid explicit values. No worker, interval, queue
or post-response business job is launched.

`vercel.json` selects the official Express framework, Node 24 comes from
package engines/.nvmrc, installation ignores lifecycle scripts and the Vercel
build explicitly generates Prisma. The Function budget is 15 seconds.
`.vercelignore` excludes local bundles, tests, fixtures, docs and environment
files; it retains runtime sources, schema/client and package metadata. Local
`npm run build` still emits `api/server.js`; `npm run build:function` emits an
independently importable `function-build/app.js` for offline acceptance.

One PostgreSQL pool is shared per warm module, capped at two connections with
5-second connection/query waits and idle release. `attachDatabasePool` is
registered only on Vercel; request handlers do not disconnect the pool. Local
adapter disposal owns pool shutdown. Driver/startup logging uses fixed event
names without credentials or raw exceptions. Neon TLS, pooled/direct role
configuration and provider connection recovery are a separate database gate.

`/healthz` reports liveness without a database query. `/readyz` runs a bounded
database query and returns fixed 200/503 JSON with no-store. A live process is
not reported as a ready database. Existing `/` behavior is preserved. V1
parsing/error contracts remain unchanged; unexpected non-v1 errors complete
with safe JSON, and partially written responses terminate safely.

## Browser and public-origin contract

The prepared same-origin frontend proxy uses the **web HTTPS origin** for both
`BETTER_AUTH_URL` and `FRONTEND_URL`. Cookies then use host-only, Secure,
HttpOnly, SameSite=Lax attributes. No Domain attribute is added. CSRF and exact
origin checks remain enabled. Legacy separate-origin configuration retains
SameSite=None in production for compatibility; deployed privacy-policy and
cookie behavior are not inferred from local HTTP checks.

## Fresh local evidence and remaining external checks

Node 24.22.2: 101 tests, lint, typecheck, normal build, exported Function build
and Prisma-only Vercel build passed. Full and production-only audits report
zero findings. Adding the current Vercel SDK initially exposed its pinned Zod
4.1.11 advisory; a scoped `@vercel/cli-config` override to 4.6.7 preserves the
same major and passes positive/negative configuration parser tests. No audit
downgrade, suppression or provider call was used.

A clean production-only install passed. The actual exported production bundle
loaded with no PORT while any attempted `listen` was configured to throw;
the harness then verified HTTP completion, database readiness, authentication,
host-only Secure/HttpOnly/Lax cookies, origin denial and truthful 503. The
legacy local production bundle and actual PostgreSQL two-user/auth regression
also passed. This is a loopback Function simulation, not a Vercel runtime or
real HTTPS-domain result. Vercel's config payload validated against its current
official schema. The provider schema's own draft meta-validation is not a
deployment acceptance result.

After credentials and approval: verify the actual Vercel framework entrypoint,
maxDuration application, traced dependency bundle/250 MB limit, Node patch,
Fluid pool lifecycle, TLS domains/cookies, deployment protection, logs and
quotas. `vercel build`/`vercel dev` project-link/account checks remain pending;
no account or project was invented to bypass them. Better Auth's local smoke
warned that no trusted client IP header was supplied; distributed rate limiting
and trusted Vercel/proxy IP handling remain the explicit security gate.

Official references checked November 1, 2026:

RPF-SEC-006 subsequently implemented shared PostgreSQL auth rate limits and
trusted-IP middleware locally. See RELEASE_SECURITY.md; actual platform/proxy
identity and HTTPS checks still need approved deployment.
[Express](https://vercel.com/docs/frameworks/backend/express),
[Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[pool lifecycle](https://vercel.com/kb/guide/connection-pooling-with-functions),
[configuration](https://vercel.com/docs/project-configuration/vercel-json).
