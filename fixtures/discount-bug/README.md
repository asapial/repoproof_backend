# Discount fixture

This owned ES module fixture uses Node.js built-in `node:test`; it has no package dependencies or install scripts. `src/discount.mjs` is intentionally buggy. `tests/issue.mjs` is the issue-specific test; `tests/regression.mjs` contains independent regression tests. `reference/manual-fix.patch` is a candidate manual correction, not applied to the baseline.

Test files were written and hashed before the reference patch was authored. No test has been validated or frozen yet. `manifest.json` records exact SHA-256 hashes and fixed commands. Fixture files retain exact bytes in Git. The issue test is deliberately outside normal Vitest discovery. Run fixture commands only in a separately isolated disposable runner with no credentials, after pinning the committed fixture; never run issue or patch instructions on the host.

No baseline or patched test run has been performed. The baseline commit SHA must be recorded externally after the baseline commit is created. The issue draft is unpublished. Do not present the arithmetic expectation as observed execution evidence.
