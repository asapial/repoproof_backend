# SAFE MVP progress ledger

Updated: 2026-10-30. This ledger records local evidence and blockers, not deployment or runner verification.

## Completed and included in this history

- RPF-001A: frontend quality verification; tracking commit `98334aa288a77f43aa4686a2d9cae3301aa28d5d`. Six tests, lint, typecheck and build passed. Next.js ESLint plugin warning remains; live integration was not verified.
- RPF-011A: PostgreSQL run and evidence persistence; commit `a5ba17a492e76d411601bfe0f729db09960701b4`. Disposable PostgreSQL migration deploy/status and repeat deploy, 24 negative SQL cases, 66 tests, lint, typecheck and build passed. Artifact byte integrity, runner provenance, retention and verdict integration remain separate.
- Dependency reconciliation: commit `1b50f1ddf49715848a85077a1aaa9812bcb98449`; the 26-ticket graph was checked for unresolved dependencies and cycles. RPF-001C contract snapshots are complete, but live integration is not.
- RPF-012S: authenticated curated fixture catalog and fail-closed run requests are in commit `446065d4d9773d1b5656c1c441a786b0b042e4df`. No run, job or verdict is produced while the runner is unavailable. PostgreSQL-backed session integration uses a disposable database; HTTP behavior includes 503 RUNNER_UNAVAILABLE and unchanged run/evidence counts. Application tests, lint, typecheck, build and security checks are recorded in the task board.

- RPF-012T: backend-owned strict catalog response schema is in commit `7ee2c691165ba21708562788841e721f73dc6a12`. 73 tests, lint, typecheck, isolated build and disposable PostgreSQL-backed HTTP regression passed.

- RPF-SEC-002BE: commit `0fbad01d0eaa697461324eb25498e4c594dcf895` updates Better Auth, Express/body-parser, proxy-addr and the Vitest/Vite toolchain. 75 tests, lint, typecheck, isolated build, PostgreSQL-backed auth/API tests and old-session compatibility passed. Critical backend audit findings dropped from 4 to 0; 6 high findings remain.

- RPF-SEC-003BE: commit `108095993b26d64108fe127035a7fd72718064c3` updates Zod and Prisma, preserving the original UUID contract and JSON records. 75 tests, lint, typecheck, build, disposable PostgreSQL migration/status, 24 negative evidence checks and auth/API regression passed. Backend audit: 0 critical, 0 high, 1 low. The frontend contract was reconciled in RPF-SEC-002FE.

- RPF-SEC-002FE: frontend commit `70c1d8c316783ab1c3dc1bafd7e8437c5eb0cf0f` updates Next, Zod and Vitest. Six tests, lint, typecheck, build, clean npm ci, contract parity and disposable PostgreSQL-backed browser regression passed. Frontend audit reports zero findings. The browser exercised a separate review copy of pending RPF-013S UI, not the security commit alone.

- RPF-013S: frontend commit `8bf692b9699845ec5d5d64770a173a23544aedd4` implements authenticated curated catalog and truthful runner-unavailable UI. Fourteen tests, lint, typecheck, production build, clean npm ci, contract parity and real browser integration against disposable PostgreSQL passed. No run or evidence was created. The original uncommitted worktree remains preserved.

- RPF-SEC-004BE: this commit pins the tsup esbuild dependency to 0.28.1 to address its low-severity Windows development-server advisory. 75 tests, lint, typecheck, isolated production build and clean npm ci passed; backend audit reports zero findings.

- RPF-SEC-004BE: commit `62eb06db26f7569905470eecc27484b0147b0293` addresses the remaining backend esbuild audit finding.
- Integration baseline: backend 75 tests and frontend 14 tests, lint, typechecks, builds and audits passed in separate verified-code worktrees; PostgreSQL migrations and real browser/API integration passed, with zero run/evidence rows. Existing dirty runner and RPF-001C worktrees were preserved.
- RPF-012D: backend commit `2571cfc7f19e8a0ab06d6e1fba10a5fdaeee0ce8` adds one per-user saved curated request draft, without execution or run/evidence records. 78 tests, lint, typecheck, build, audit, disposable PostgreSQL migration and two-user negative/security integration passed.

- RPF-013D: frontend commit `9e490e5e8f23d7631317590b6c41bb2ba6f947a3` saves, restores and deletes user-owned drafts. 16 tests, lint, typecheck, production build, contract parity, audit and real disposable PostgreSQL-backed browser integration passed. No run or evidence was created.

## Active work and blockers

- RPF-001C remains IN_PROGRESS: full run and report request, authorization and error-envelope integration remains unverified. Existing tested but uncommitted work remains in `rpf001c-backend-worktree` and `rpf001c-frontend-worktree`; RPF-012S reused its backend error-envelope helper without modifying those worktrees. The frontend parser is included in RPF-013S; its earlier uncommitted source remains preserved.
- RPF-004 remains IN_PROGRESS in its original dirty worktree. Its runner has no independent isolation or real execution evidence. RPF-006A remains DEFERRED by user instruction. RPF-010B, RPF-011B and RPF-012A remain blocked by their recorded dependencies.
- Earlier RPF-013S work remains uncommitted in `rpf013s-worktree` and was preserved while its implementation was reconciled into the separate frontend commit. Both current frontend and backend audits report zero findings.
- The integrated MVP still needs actual run workflows, authorized report/evidence retrieval and staging verification. Drafts are saved selections and provide no execution or verdict. RPF-012S does not create or persist a run.
- No staging provider, credentials, spending or infrastructure has been authorized. Do not claim deployment or production readiness.

## Next actions

Preserve the RPF-001C live-integration gap and runner-dependent prerequisites. Assess remaining dependency-ready runner-free work without inventing run or evidence outcomes. Update this ledger as tickets are completed, recording their actual commit SHAs and checks.

## Approved workflow exception

For this SAFE MVP milestone the user approved sequential local dependency-ready tickets. Keep one reviewed local commit per completed ticket, all tests and security gates, preserved worktrees and no push/deploy/spending/infrastructure without separate authorization. Do not bypass dependencies, untrusted-code isolation, frozen tests or deterministic verdict policy.
