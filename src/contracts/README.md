# RepoProof API v1 contracts

`src/contracts/v1.ts` defines `/api/v1` JSON DTOs using Zod and inferred TypeScript types. RPF-012S implements a limited catalog and fail-closed run request; these schemas do not imply that the complete run lifecycle routes exist. Future route handlers must parse untrusted inputs, authorize ownership and fixture access, enforce idempotency, and apply deterministic verification policy. DTO validation alone does not prove evidence or assign a verdict.

The create-run, run plan, approval header, event, report, and error shapes follow the MVP requirements. Event cursors are decimal query strings transformed to numbers; page events must be ordered, and a nonempty page cursor equals its last sequence. `plan` and `reportUrl` are nullable. Report data without a patch cannot include patched test evidence. Artifact access uses run and artifact IDs; report Markdown and artifact bytes are not JSON DTOs. Repository lists, issue lists, cancellation responses, and history need explicit shapes before those endpoints are implemented.

The frontend contract snapshot is pinned to backend source; live frontend-to-API integration remains pending. RPF-012S returns v1 envelopes for its unavailable and security errors; legacy authentication and health behavior remains separate.

`safeMvp.ts` owns the strict curated fixture catalog response used by the RPF-012S backend. Clients should pin and validate this schema. It exposes public curated metadata only; it is not a live GitHub response, run result or verdict.
