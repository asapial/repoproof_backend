# Discount fixture

This owned ES module fixture uses Node.js built-in `node:test`; it has no package dependencies or install scripts. `src/discount.mjs` is intentionally buggy. `tests/issue.mjs` is the issue-specific test; `tests/regression.mjs` contains independent regression tests. `reference/manual-fix.patch` is a candidate manual correction, not applied to the baseline.

The issue test was hashed before applying the reference patch to a separate disposable checkout. `manifest.json` records exact SHA-256 hashes and fixed commands. Fixture files retain exact bytes in Git. The issue test is deliberately outside normal Vitest discovery. Run fixture commands only in a separately isolated disposable runner with no credentials, after pinning the committed fixture; never run issue or patch instructions on the host.

Baseline commit `f56bcb6d6dbae99b0805ac8b6c7162e6994447bc` was tested in constrained, network-disabled containers. The baseline issue test failed with `ERR_ASSERTION` (120 versus 80), and two regressions passed. The reference patch passed the same issue test and both regressions; test hashes remained unchanged. See `manifest.json` for counts and provenance. The issue draft is unpublished. The recovered plan calls for Vitest JSON; these tests use Node TAP, so that evidence remains outstanding.
