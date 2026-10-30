# SAFE MVP progress ledger

Updated: 2026-10-30. This ledger records local evidence and blockers, not deployment or runner verification.

## Completed and included in this history

- RPF-001A: frontend quality verification; tracking commit `98334aa288a77f43aa4686a2d9cae3301aa28d5d`. Six tests, lint, typecheck and build passed. Next.js ESLint plugin warning remains; live integration was not verified.
- RPF-011A: PostgreSQL run and evidence persistence; commit `a5ba17a492e76d411601bfe0f729db09960701b4`. Disposable PostgreSQL migration deploy/status and repeat deploy, 24 negative SQL cases, 66 tests, lint, typecheck and build passed. Artifact byte integrity, runner provenance, retention and verdict integration remain separate.
- Dependency reconciliation: commit `1b50f1ddf49715848a85077a1aaa9812bcb98449`; the 26-ticket graph was checked for unresolved dependencies and cycles. RPF-001C contract snapshots are complete, but live integration is not.
- RPF-012S: authenticated curated fixture catalog and fail-closed run requests are in commit `446065d4d9773d1b5656c1c441a786b0b042e4df`. No run, job or verdict is produced while the runner is unavailable. PostgreSQL-backed session integration uses a disposable database; HTTP behavior includes 503 RUNNER_UNAVAILABLE and unchanged run/evidence counts. Application tests, lint, typecheck, build and security checks are recorded in the task board.

- RPF-012T: backend-owned strict catalog response schema is in commit `7ee2c691165ba21708562788841e721f73dc6a12`. 73 tests, lint, typecheck, isolated build and disposable PostgreSQL-backed HTTP regression passed.

- RPF-SEC-002BE: this commit updates Better Auth, Express/body-parser, proxy-addr and the Vitest/Vite toolchain. 75 tests, lint, typecheck, isolated build, PostgreSQL-backed auth/API tests and old-session compatibility passed. Critical backend audit findings dropped from 4 to 0; 6 high findings remain.

## Active work and blockers

- RPF-001C remains IN_PROGRESS: live frontend/backend request, authorization, error-envelope and report integration are unverified. Existing tested but uncommitted work remains in `rpf001c-backend-worktree` and `rpf001c-frontend-worktree`; RPF-012S reused its backend error-envelope helper without modifying those worktrees. The frontend parser remains unintegrated.
- RPF-004 remains IN_PROGRESS in its original dirty worktree. Its runner has no independent isolation or real execution evidence. RPF-006A remains DEFERRED by user instruction. RPF-010B, RPF-011B and RPF-012A remain blocked by their recorded dependencies.
- RPF-013S has uncommitted UI code in `rpf013s-worktree`: 14 unit tests, production build and real browser signup/session/catalog/503/logout integration passed with a disposable PostgreSQL database; no run/evidence rows were created. The branch is not yet committed. Existing frontend audit reports 2 critical and 2 high findings; backend still has 6 high findings after RPF-SEC-002BE. Remediation is required before declaring security readiness.
- The integrated MVP still needs safe persisted run workflows, authorized report/evidence retrieval and staging verification. RPF-012S does not create or persist a run.
- No staging provider, credentials, spending or infrastructure has been authorized. Do not claim deployment or production readiness.

## Next actions

Complete RPF-SEC-003BE and RPF-SEC-002FE security remediation, then reconcile the tested RPF-013S and RPF-001C frontend changes without overwriting their worktrees. Identify a separately scoped safe persistence path without enabling runner execution or weakening RPF-012A/010B prerequisites. Update this ledger as tickets are completed, recording their actual commit SHAs and checks.

## Approved workflow exception

For this SAFE MVP milestone the user approved sequential local dependency-ready tickets. Keep one reviewed local commit per completed ticket, all tests and security gates, preserved worktrees and no push/deploy/spending/infrastructure without separate authorization. Do not bypass dependencies, untrusted-code isolation, frozen tests or deterministic verdict policy.
