# Development-toolchain advisory remediation

RPF-SEC-005BE, checked November 1, 2026. The fresh audit reported 11 moderate
affected development packages caused by minimatch glob-parts amplification
([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)).
Production-only audit had zero findings. These are not eleven independent
production vulnerabilities.

Use ESLint 10.14.0 and typescript-eslint 8.72.1. ESLint 10 is the current
[supported major](https://eslint.org/version-support/); typescript-eslint's
[peer ranges](https://typescript-eslint.io/users/dependency-versions/) include
ESLint 10 and the installed TypeScript 6.0.3. Node must satisfy ESLint's
`^20.19.0 || ^22.13.0 || >=24` engine. Do not accept npm audit's suggested
ESLint 4 downgrade or force incompatible peer dependencies.

Current upstream packages still request minimatch 10. The advisory affects
all versions below 11.0.1. Scoped overrides pin minimatch 11.0.3 for ESLint,
@eslint/config-array and @typescript-eslint/typescript-estree only. These
consumers use named `minimatch`/`Minimatch` exports available in version 11.
The override crosses a major boundary, so `node scripts/check-lint-toolchain.mjs`
checks each actual nested resolution, positive/negative TypeScript linting and
generated-file exclusion. The complete application lint also passes. Remove
overrides only after upstream dependency ranges include patched releases and
these checks pass again. No runtime dependency changed in this ticket.

Fresh checks: 87 application tests; lint; typecheck; production build; clean
`npm ci --ignore-scripts`; toolchain compatibility; real disposable PostgreSQL
two-user drafts and auth/API regression; frontend contract parity. Full and
production-only npm audits both report zero findings. Exact command records
and source status are stored locally under
`output/predeployment-2026-11-01/evidence/sec005be-*` in the parent workspace.
Audit findings can change; this is neither a full application security audit
nor evidence of deployed HTTPS, provider behavior or runner isolation.
