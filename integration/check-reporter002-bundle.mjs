// Supply only the fresh output of build-reporter002.mjs. Trusted primitives only.
// This imports owned instrumentation, never generated tests or fixture source.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.version, "v24.22.2");
const directory = process.argv[2];
assert.ok(directory && isAbsolute(directory), "Supply the trusted instrumentation build directory");
const names = ["counter.mjs", "native-reporter.mjs", "protocol.mjs"];
const root = resolve(directory), manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
assert.deepEqual(manifest.files.map(file => file.name), names);
assert.equal(manifest.purpose, "OFFLINE_INSTRUMENTATION_PREPARATION");
for (const file of manifest.files) {
  const bytes = await readFile(resolve(root, file.name));
  assert.equal(bytes.length, file.byteLength);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
}
const { createAssertionCounter, assertionMarker, encodeAssertionEvent } = await import(pathToFileURL(resolve(root, names[0])));
const { OwnedNodeEventCollector } = await import(pathToFileURL(resolve(root, names[1])));
const { OwnedReporterCollector } = await import(pathToFileURL(resolve(root, names[2])));
const blueprint = { version: "rpf-assertion-blueprint-v1", expectedFile: "/owned/bundled-unit-self-test.mjs",
  tests: [{ index: 1, name: "trusted bundle primitives", assertions: 2 }],
  reporter: { version: "rpf-reporter-v1", assertionsPerTest: [2], plan: { provenance: "SYNTHETIC_OFFLINE_FIXTURE",
    expectedTests: 1, expectedAssertions: 2, maxDurationMs: 5000,
    binding: { runId: "10000000-0000-4000-8000-000000000001", executionId: "10000000-0000-4000-8000-000000000002",
      stage: "BASELINE", suite: "ISSUE", baseSha: "a".repeat(40), frozenManifestSha256: "b".repeat(64),
      snapshotSha256: "c".repeat(64), testSha256: "d".repeat(64), runnerImageDigest: "e".repeat(64), commandManifestSha256: "f".repeat(64) } } } };
for (const failed of [false, true]) {
  const ctx = { name: blueprint.tests[0].name, fullName: blueprint.tests[0].name, filePath: blueprint.expectedFile }, counters = [];
  const counter = createAssertionCounter(blueprint, () => ctx, event => counters.push(event));
  counter.equal(1, 1);
  let failure;
  try { counter.strictEqual(2, failed ? 3 : 2); } catch (error) { failure = error; }
  if (failed) { assert.ok(failure instanceof assert.AssertionError); assert.equal(failure.code, "ERR_ASSERTION"); }
  else assert.equal(failure, undefined);
  const native = new OwnedNodeEventCollector(blueprint);
  native.write({ type: failed ? "test:fail" : "test:pass", data: { name: ctx.name, file: ctx.filePath, nesting: 0,
    details: failed ? { error: { cause: failure } } : {} } });
  for (const event of counters) native.write({ type: "test:diagnostic", data: { file: ctx.filePath, nesting: 0,
    message: assertionMarker + encodeAssertionEvent(event) } });
  native.write({ type: "test:summary", data: { success: !failed, counts: { tests: 1, passed: failed ? 0 : 1,
    failed: failed ? 1 : 0, skipped: 0, cancelled: 0, todo: 0, suites: 0, topLevel: 1 } } });
  const normalized = native.finish(); assert.equal(normalized.ok, true);
  const collector = new OwnedReporterCollector(blueprint.reporter); assert.equal(collector.write(normalized.bytes), true);
  const result = collector.finish({ startedAtMs: 1000, finishedAtMs: 1010, exitCode: failed ? 1 : 0, timedOut: false,
    setupFailure: false, stdoutSha256: "1".repeat(64), stderrSha256: "2".repeat(64), artifactManifestSha256: "c".repeat(64) });
  assert.equal(result.ok, true);
  assert.equal(result.value.decoded.classification, failed ? "ASSERTION_FAILURE" : "PASS");
  assert.equal(result.value.decoded.receipt.counts.assertionsPassed, failed ? 1 : 2);
  assert.equal(result.value.decoded.receipt.counts.assertionsFailed, failed ? 1 : 0);
  assert.equal(result.value.authentic, false);
  console.log(JSON.stringify({ result: "PASS", scope: "TRUSTED_BUNDLED_PRIMITIVE_SELFTEST", bundlesSha256Checked: names.length,
    counts: result.value.decoded.receipt.counts, authentic: false, fixtureCodeExecutions: 0, providerCalls: 0 }));
}
