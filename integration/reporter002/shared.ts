// Trusted instrumentation self-tests, not generated regression or fixture source.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AssertionBlueprint } from "../../src/verification/assertionCounter";
const allowed = ["pass.ts","fail.ts"].map(name => fileURLToPath(new URL(name,import.meta.url)));
export const selfTestName = "trusted primitive instrumentation ABI";
export function selfTestBlueprint(file: string): AssertionBlueprint {
  if (!allowed.includes(file)) throw new Error("Trusted instrumentation file required");
  const hash = createHash("sha256").update(file).digest("hex");
  return { version: "rpf-assertion-blueprint-v1",expectedFile: file,tests: [{ index: 1,name: selfTestName,assertions: 2 }],
    reporter: { version: "rpf-reporter-v1",assertionsPerTest: [2],plan: { provenance: "SYNTHETIC_OFFLINE_FIXTURE",expectedTests: 1,expectedAssertions: 2,maxDurationMs: 7000,
      binding: { runId: "10000000-0000-4000-8000-000000000001",executionId: file === allowed[0] ? "10000000-0000-4000-8000-000000000002" : "10000000-0000-4000-8000-000000000003",
        stage: "BASELINE",suite: "ISSUE",baseSha: "a".repeat(40),frozenManifestSha256: hash,snapshotSha256: hash,testSha256: hash,runnerImageDigest: hash,commandManifestSha256: hash } } } };
}
export function allowedSelfTestFile(file: unknown): file is string { return typeof file === "string" && allowed.includes(file); }
