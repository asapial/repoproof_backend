# Owned Node assertion instrumentation

RPF-REPORTER-002 prepares the counter and native-event adapter for
RPF-REPORTER-001. It is unregistered and changes no application endpoint, runner
permission, frozen test, model task or verdict policy. It does not complete the
isolated runner or authenticate guest execution.

## Counter and event boundary

The controller derives a blueprint from the private admitted snapshot without
evaluating it. Fixture pin, stage, test bytes, frozen manifest, snapshot identity,
test names and per-test assertion counts must match the execution plan. Exact
frozen bytes remain unchanged. Production blueprint paths name the exclusive
prepared guest tree, never a caller-selected host path.

The one-shot preload supports the explicitly tested Node **24.22.2** ABI. It
requires `node:test.getTestContext`, unmodified native strict assertion functions
and writable/configurable descriptors before installation. It replaces only
`assert.equal` and `assert.strictEqual` with nonwritable, nonconfigurable wrappers.
The admitted grammar permits only those two-argument numeric assertions, with
no nested tests, asynchronous callbacks, diagnostic access or exception catching.

Each wrapper calls the original native assertion before emitting a bounded
canonical diagnostic. A genuine `ERR_ASSERTION` emits one failed assertion and
rethrows the original error object. Wrong file/name/full-name/context identity,
extra arguments, excess assertions or diagnostic failures poison the counter.
Events include blueprint/plan hashes, test/assertion indices and outcome only;
assertion values, messages, stack traces and credentials are excluded.

The adapter consumes Node event objects, not arbitrary stdout. It validates native
result identity, summaries and explicit counter diagnostics. It joins diagnostics
that arrive after their native result, rejects duplicate/bad bindings and count
contradictions, limits events/output, and emits the existing owned protocol only
after complete collection. Native passing tests without counters cannot pass.
Import/setup/unknown failures and zero/skipped/incomplete runs cannot establish
reproduction or successful verification. Timeout/process/artifact observations
still come independently from the controller.

Every result retains `authentic: false`. Diagnostics and native events inside an
untrusted guest are forgeable; matching hashes/counts do not grant trust. A
protected image, approved isolated runtime, independently observed process and
artifact integrity, and proven provenance remain required before any verdict.

## Reproduce local preparation checks

Use pinned Node 24.22.2 and the repository lockfile. Commands run from this backend
checkout or a secret-free source-hashed review copy. They execute only the two
explicit trusted numeric self-test modules, never fixture/generated/model source.

```powershell
npm test -- src/verification/assertionCounter.test.ts src/verification/nodeReporter.test.ts src/verification/reporter.test.ts --maxWorkers=1
node --import tsx integration/rpfreporter002-selftest.ts
node node_modules/typescript/bin/tsc -p tsconfig.instrumentation.json --noEmit
npm run check
node integration/build-reporter002.mjs C:\path\to\fresh-instrumentation-output
node integration/check-reporter002-bundle.mjs C:\path\to\fresh-instrumentation-output
```

The standalone build preserves `node:` imports using `removeNodeProtocol: false`;
tsup's default rewrites the prefix-only `node:test` import to unresolvable `test`.
Babel and Zod are bundled, and the built-in require bridge supports their runtime
code without loading project dependencies. The output directory must be new.
The manifest records exact byte lengths/SHA-256 for all three bundles. The
standalone checker validates those bytes and both passing/failing native
assertions from a directory outside `node_modules`.

The source self-test verifies the real process-isolated Node reporter ABI,
immutable assertion descriptors, refusal to install twice, positive executed
counts, native failure classification and explicit assertion metadata. Its
deliberate assertion failure is an instrumentation test, not bug reproduction.

Fresh accepted checks: 68 focused tests; 709 full tests across 45 files; lint,
source/instrumentation types, production build, lint-toolchain check and full/
production dependency audits with zero findings. Both real Node numeric cases
and both hash-checked standalone primitive cases passed. Historical failed
bundle/loader/lint attempts remain in the local evidence directory. Accepted
logs and command/exit/hash records use `reporter002-resume-*` under
`output/meta-engine-2026-11-02/evidence` outside Git. All fixture executions and
provider calls remain zero.

Node event/ABI references, checked November 2, 2026:
[test runner and custom reporters](https://nodejs.org/docs/latest-v24.x/api/test.html),
[context lookup](https://nodejs.org/docs/latest-v24.x/api/test.html#testgettestcontext).
RPF-004 remains IN_PROGRESS; RPF-006A remains DEFERRED; parent RPF-005 is incomplete.
