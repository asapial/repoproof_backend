// Only the two trusted numeric instrumentation modules are allowed child tests.
// Never use this harness for generated/fixture/repository source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OwnedReporterCollector } from "../src/verification/reporter";
import { selfTestBlueprint } from "./reporter002/shared";
assert.equal(process.version,"v24.22.2");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const cases: { file: string;expectedExit: number;classification: string }[] = [
  { file: "pass.ts",expectedExit: 0,classification: "PASS" },{ file: "fail.ts",expectedExit: 1,classification: "ASSERTION_FAILURE" },
];
for (const scenario of cases) {
  const file = resolve("integration/reporter002",scenario.file), blueprint = selfTestBlueprint(file), startedAtMs = Date.now();
  const child = spawnSync(process.execPath,["--import","tsx","--test","--test-concurrency=1","--test-isolation=process",
    "--test-reporter",pathToFileURL(resolve("integration/reporter002/reporter.ts")).href,file],{ timeout: 10000,maxBuffer: 65536,windowsHide: true });
  const finishedAtMs = Date.now();
  if (child.error || child.signal || child.status !== scenario.expectedExit) {
    // These are trusted test/runtime diagnostics, never issue/provider inputs.
    process.stderr.write(child.stderr ?? Buffer.alloc(0)); throw new Error("Trusted instrumentation process failed");
  }
  const collector = new OwnedReporterCollector(blueprint.reporter); assert.equal(collector.write(child.stdout),true);
  const result = collector.finish({ startedAtMs,finishedAtMs,exitCode: child.status,timedOut: false,setupFailure: false,
    stdoutSha256: hash(child.stdout),stderrSha256: hash(child.stderr),artifactManifestSha256: blueprint.reporter.plan.binding.snapshotSha256 });
  assert.equal(result.ok,true); if (!result.ok) throw new Error("Trusted instrumentation receipt invalid");
  assert.equal(result.value.decoded.classification,scenario.classification); assert.equal(result.value.decoded.authentic,false);
  assert.equal(result.value.decoded.receipt.counts.executed,1); assert.equal(result.value.decoded.receipt.counts.assertionsPassed,scenario.expectedExit ? 1 : 2);
  assert.equal(result.value.decoded.receipt.counts.assertionsFailed,scenario.expectedExit ? 1 : 0);
  assert.equal(result.value.decoded.receipt.tests[0]?.failureKind,scenario.expectedExit ? "ASSERTION" : null);
  assert.equal(result.value.decoded.receipt.counts.skipped,0);
  console.log(JSON.stringify({ result: "PASS",scope: "TRUSTED_NUMERIC_INSTRUMENTATION_SELFTEST",case: scenario.file,nativeExitCode: child.status,
    classification: result.value.decoded.classification,counts: result.value.decoded.receipt.counts,authentic: false,fixtureCodeExecutions: 0,providerCalls: 0 }));
}
