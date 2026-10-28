# RPF-002 — Owned Reproducible Bug Fixture

> Status source: `repoproof_backend/docs/TASK_BOARD.md` (the canonical tracked task board).
> Requirements source: RepoProof v2 `docs/plan.md`, Section 4 (Day 1), Section 5 (backlog), and Section 6 (Fixture A). Original source is bundled at `reference/RepoProof_v2_original_plan.md` in the recovery archive.
> This file gives the requested source requirements and separately identifies two-repository adaptations. Do not silently treat adaptations as quotations from the original plan.

## 1. Original RPF-002 requirements — source extract

### Ticket definition (Section 5)

`RPF-002 | P0 | 3h | 001 | Fixture A code + real GitHub issue + base SHA`

The older backlog uses `001`; the current two-repository board replaces that setup dependency with `RPF-001B`. Use the actual board for current dependency/status.

### Day 1 fixture tasks (Section 4)

> Create owned **fixture GitHub repository** with a documented bug in `src/pricing.ts`, deterministic Vitest tests and frozen base SHA. Open an actual issue describing reproduction steps.

> Use fixture A to manually demonstrate assertion fail on baseline and pass after a **known manual fix** (this is a runner smoke test, not agent success).

The legacy plan also asks for a Meta API smoke call on Day 1, but that is a **separate** existing ticket `RPF-003`, not part of RPF-002 implementation in the two-repo task board.

### Fixture A — Legitimate fix (Section 6)

> **Fixture description:** `src/pricing.ts` incorrectly calculates a percentage discount by adding rather than subtracting.
>
> - Pinned buggy base example: `price * (1 + discountPercent / 100)`.
> - Issue: `applyDiscount(100, 20)` expected `80`, observed `120`.
> - Before patch: issue-specific test executes and fails with an assertion; existing non-issue regression tests pass.
> - After a valid patch: identical issue test executes and passes; existing regressions still pass.
> - Required artifacts: issue URL, base SHA, frozen test source+SHA, before and after Vitest JSON, source diff and policy verdict.
> - Success if real agent produces a correct permitted patch under configured budget; otherwise report rejection and improve prompts, not fake success.

**Scope clarification:** RPF-002 can show *manual reference-fix* pass/fail evidence; it must NOT describe that as a Meta-generated patch or a completed end-to-end verdict. Real runner/model integration is assigned to subsequent tickets.

## Ticket-scoped evidence decision (2026-10-28)

The owner explicitly accepts genuine Node `node:test` TAP for RPF-002 in place of the original Vitest JSON format. This exception applies only to this ticket and does not change the behavioral acceptance requirements quoted above. The owned fixture uses Node built-ins without dependencies or install scripts. Its issue and regression test bytes were frozen and hashed before the reference patch; rewriting them for Vitest would change their identity and invalidate the existing baseline-to-patch provenance. TAP must never be described as Vitest JSON.

Evidence must show a real assertion failure on the pinned buggy baseline, positive executed counts, unchanged frozen test identities and SHA-256 hashes, the successful manual reference patch, passing regressions, and actual execution results. A setup failure, skipped or zero tests, altered tests, or a model statement is not proof. The manual reference patch is not an agent-generated fix or a policy verdict. A real issue URL and all remaining acceptance requirements are still required for completion.

## 2. Current RepoProof two-repository adaptation — added implementation guidance

**Existing repositories:**

- `repoproof_backend/` — ticket owner; do the RPF-002 work on its actual existing codebase, preserving Git history.
- `repoproof_frontend/` — not modified in this ticket.

**Task board requirement (current board):**

`RPF-002 | backend | DONE | RPF-001B | Owned pinned JS/TS fixture, real failing issue test, known manual fix` (the canonical board is authoritative).

**Suggested bounded implementation (adaptation, not a verbatim legacy plan):**

1. Check `git status`, current branch/HEAD, `docs/TASK_BOARD.md`, and existing test/fixture structure before choosing paths. Reuse any relevant user-owned files after reviewing diffs; preserve unrelated dirty files.
2. Create a small owned fixture under a directory selected to match the backend structure (for example `fixtures/discount-bug/`), with a purposely incorrect `src/pricing.ts`. Do not scaffold or initialize an additional application or nested Git repository without authorization.
3. Keep issue-specific failing Node assertion out of the default backend green CI suite. Arrange dedicated commands so the failure is intentional and measured rather than a broken build.
4. Verify a meaningful assertion failure on the unchanged buggy baseline and passing unrelated regression tests. Distinguish assertion failures from import/setup errors and skipped/zero tests.
5. Create a separate known-correct manual patch (a patch file or equivalent isolated reference artifact), then test it in a disposable copy/worktree. The baseline fixture must remain buggy and unchanged. Reuse the same issue test bytes and record SHA-256.
6. Capture real bounded outputs and metadata: test command ID, native Node TAP results and, where useful, separately labeled machine-readable results derived from execution, source hashes, patch diff, fixture identity, and actual Git SHA(s). Do not invent a test run, Git hash, GitHub issue URL, or agent result.
7. Treat an actual GitHub issue URL as an external-publication requirement: if it does not exist, prepare an issue draft and request separate authorization to publish. Do not claim the original source's full acceptance is satisfied without the real URL.
8. Before claiming the fixture has a **pinned buggy commit SHA**, verify the commit actually includes the buggy fixture. A Git commit cannot include its own final SHA inside itself: if the only allowed delivery is one commit, record the resulting actual SHA in the final report and request approval for a separate tracking commit or externally maintained fixture manifest if persistent metadata is required.
9. Run dedicated fixture assertions, backend unit tests, lint, typecheck, production build, `git diff --check`, and staged secret review. Do not execute unknown third-party code or run a new public sandbox service.
10. Stage only this ticket's files. Update the canonical board truthfully. Make ONE scoped local Conventional Commit **only if** all ticket acceptance gates, including the pinned baseline and required issue evidence, are satisfied; otherwise keep `IN_PROGRESS` with a precise blocker. No push, merge, deploy, or additional ticket.

**Proposed commit subject (when legitimately ready):**

`test(fixtures): add reproducible pricing bug scenario`

Commit body must include `Refs: RPF-002`.

## 3. Acceptance evidence checklist

The backend quality checks below refer to the tracking branch; the separately documented public-base typecheck exception applies.

- [x] Exact owned fixture source and dependency/test setup
- [x] `applyDiscount(100, 20)` returns `120` on buggy baseline, expected `80`
- [x] Dedicated issue-specific test produces an actual assertion failure before fix
- [x] Unrelated fixture regression tests pass at baseline
- [x] Known manual fix passes the **same** unchanged issue test and regressions
- [x] Test source hash, run results, diff and source provenance recorded accurately
- [x] Buggy baseline pinned to a real, reproducible commit SHA
- [x] Real GitHub issue URL exists, or missing approval recorded as blocker
- [x] Existing backend tests, lint, typecheck and build pass
- [x] Staged files contain no unrelated edits or secrets
- [x] Canonical task board updated with truthfully observed evidence
- [x] One focused local commit, or explicit `IN_PROGRESS`/`BLOCKED` with reason

## 4. Do not conflate with later tickets

- `RPF-003`: real Meta Model API adapter
- `RPF-004`: isolated allowlisted fixture runner
- `RPF-005`: generic structured test-result parser
- `RPF-006B`: AI/curated test generation and immutable pre-patch freezing workflow
- `RPF-010B`: connecting real runner artifacts to the deterministic verdict policy

The original plan is a **design specification**, not proof that any fixture, issue URL, or runner exists in the local repository.

## Publication evidence and public-base limitation

Public baseline: `1066351c5b07bed024775a16af9151048a9316b2`; issue: https://github.com/asapial/repoproof_backend/issues/1. The clean baseline and manual fix were tested with native Node TAP and unchanged frozen test hashes. The known manual patch is stored in the tracking branch, not the public baseline. Historical local baseline `f56bcb6d6dbae99b0805ac8b6c7162e6994447bc` and evidence commit `e3921db059ae3740a76153b06cbfceabf50928b4` are preserved as historical evidence. The public-base and fixture-candidate TypeScript checks produced identical 14 pre-existing diagnostics; neither complete typecheck passed. The owner accepted this ticket-scoped limitation after comparison.
