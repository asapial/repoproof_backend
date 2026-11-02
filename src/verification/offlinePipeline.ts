import { MetaTaskProvider } from "../meta/tasks";
import type { MetaRequest } from "../utils/metaAdapter";
import { decideVerdict, type PolicyEvidence, type PolicyResult } from "./policy";
import { freezeDiscountTest, frozenTestsEquivalent, generatedIssuePath, prepareBaseline, prepareDiscountPatch, readSnapshot,
  sha256, snapshotBytesMatch, type FrozenTest, type PreparedSnapshot } from "./frozen";
import { intakeOwnedSnapshot, ownedModelSource, readOwnedManifest, readOwnedSnapshot, type OwnedSnapshotInput } from "./intake";
import { decodeExecutionReceipt, type ExecutionPlan } from "./results";
import { offlineScenarioSchema, syntheticExecution, syntheticModel, syntheticPatchProposal, syntheticTestProposal, type OfflineScenario } from "./offlineFixtures";

type SimulationState = "INTAKE" | "GENERATE_TEST" | "FROZEN" | "BASELINE_ISSUE" | "BASELINE_REGRESSIONS" | "PATCH_REQUESTED" |
  "PATCH_PREPARED" | "PATCHED_ISSUE" | "PATCHED_REGRESSIONS" | "CANCELLED" | "QUARANTINED" | "SIMULATED_DECISION";
export type OfflineSimulation = Readonly<{ mode: "SYNTHETIC_OFFLINE_FIXTURE"; productionVerdict: "INCONCLUSIVE"; liveProviderCalls: 0;
  patchAttempts: number; testProposals: number; receiptFixtures: number; reconciliationRequired: boolean;
  policySimulation: PolicyResult; trace: readonly Readonly<{ sequence: number; state: SimulationState }>[]; errors: readonly string[] }>;

/** A closed synthetic harness, never a live controller. No caller-supplied provider or executor is accepted. */
export async function simulateOfflineDiscount(input: OwnedSnapshotInput, scenarioInput: OfflineScenario): Promise<OfflineSimulation> {
  let patchAttempts = 0, testProposals = 0, receiptFixtures = 0, reconciliationRequired = false;
  const trace: { sequence: number; state: SimulationState }[] = [], errors: string[] = [];
  const step = (state: SimulationState) => { const sequence = trace.length + 1; trace.push({ sequence, state }); return sequence; };
  let evidence: PolicyEvidence = { baseSha: input?.baseSha, frozen: null, baseline: null, patch: null, patched: null, requiredCheckIds: ["regressions"], checks: [] };
  const finish = (): OfflineSimulation => {
    step("SIMULATED_DECISION");
    const policySimulation = decideVerdict(evidence);
    Object.freeze(policySimulation.evidenceRefs); Object.freeze(policySimulation);
    return Object.freeze({ mode: "SYNTHETIC_OFFLINE_FIXTURE", productionVerdict: "INCONCLUSIVE", liveProviderCalls: 0,
      patchAttempts, testProposals, receiptFixtures, reconciliationRequired, policySimulation,
      trace: Object.freeze(trace.map(event => Object.freeze({ ...event }))), errors: Object.freeze([...errors]) });
  };
  try {
    const scenario = offlineScenarioSchema.parse(scenarioInput);
    step("INTAKE"); const intake = intakeOwnedSnapshot(input), source = ownedModelSource(intake);
    const metadata = JSON.parse(readOwnedManifest(intake).toString("utf8"));
    evidence = { ...evidence, baseSha: source.baseSha };
    const generator = { async generate<T>(request: MetaRequest<T>) {
      const envelope = JSON.parse(request.prompt);
      if (envelope.trust !== "DATA_ONLY") throw new Error("SYNTHETIC_DATA_BOUNDARY");
      const proposal = request.schemaName === "regression_test" ? syntheticTestProposal(scenario) :
        request.schemaName === "source_patch" ? syntheticPatchProposal(scenario, source.baseSha, source.files[0]!.sha256) : null;
      if (scenario === "GENERATOR_ERROR") throw new Error("SYNTHETIC_GENERATOR_ERROR");
      return { data: request.validator.parse(proposal), metadata: { id: "synthetic-response", model: syntheticModel, latencyMs: 0,
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } } };
    } };
    const catalog = { async list() { return { object: "list" as const, data: [{ id: syntheticModel, object: "model" as const, created: 1, owned_by: "synthetic-fixture" }] }; } };
    const provider = new MetaTaskProvider(syntheticModel, catalog, generator);
    step("GENERATE_TEST"); testProposals++;
    const generated = await provider.generateRegressionTest(source);
    const frozen = freezeDiscountTest(readOwnedSnapshot(intake), Buffer.from(generated.data.content));
    const freezeSequence = step("FROZEN"), baseline = prepareBaseline(frozen);
    const frozenBytes = readSnapshot(baseline).find(file => file.path === generatedIssuePath)!.content;
    evidence.frozen = { bytes: Uint8Array.from(frozenBytes), sha256: sha256(frozenBytes), testId: generatedIssuePath, sequence: freezeSequence, ref: "synthetic:freeze:" + frozen.manifestSha256 };
    const execute = (snapshot: PreparedSnapshot, suite: "ISSUE" | "REGRESSIONS", state: SimulationState) => {
      const sequence = step(state), path = suite === "ISSUE" ? generatedIssuePath : "tests/regression.mjs";
      const seal = snapshot.files.find(file => file.path === path)!;
      const plan: ExecutionPlan = { provenance: "SYNTHETIC_OFFLINE_FIXTURE", binding: {
        runId: "10000000-0000-4000-8000-000000000001", executionId: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        stage: snapshot.stage, suite, baseSha: source.baseSha, frozenManifestSha256: frozen.manifestSha256, snapshotSha256: snapshot.snapshotSha256,
        testSha256: seal.sha256, runnerImageDigest: String(metadata.runtime.containerImage).replace("node@sha256:", ""),
        commandManifestSha256: sha256(Buffer.from(JSON.stringify(["node", "--test", path]))) }, expectedTests: seal.tests, expectedAssertions: seal.assertions, maxDurationMs: 1000 };
      receiptFixtures++;
      let fixture;
      try { fixture = syntheticExecution(scenario, plan, snapshot); }
      catch { reconciliationRequired = true; step("QUARANTINED"); errors.push("SYNTHETIC_UNCERTAIN_EXECUTION"); return null; }
      const parsed = decodeExecutionReceipt(fixture.receiptBytes, plan);
      if (!parsed.ok) { errors.push(parsed.reason); return null; }
      const actualTest = fixture.artifacts.find(file => file.path === generatedIssuePath);
      if (!snapshotBytesMatch(snapshot, fixture.artifacts)) {
        errors.push("ARTIFACT_BYTES_MISMATCH");
        // Carry independently observed synthetic test hash into policy so a
        // contradictory success receipt cannot hide exact-byte test tampering.
        if (!actualTest || sha256(actualTest.content) === evidence.frozen!.sha256) return null;
      }
      const r = parsed.value.receipt;
      const outcome = parsed.value.classification === "PASS" ? "PASSED" as const : parsed.value.classification === "ASSERTION_FAILURE" ? "FAILED" as const :
        r.timedOut ? "TIMEOUT" as const : r.counts.executed === 0 ? "NO_TESTS" as const : "ERROR" as const;
      return { outcome, ...r.counts, exitCode: r.exitCode, failureKind: parsed.value.classification === "ASSERTION_FAILURE" ? "ASSERTION" as const :
        parsed.value.classification === "PASS" ? null : "UNKNOWN" as const,
        baseSha: r.binding.baseSha, runnerImageDigest: r.binding.runnerImageDigest, commandManifestSha256: r.binding.commandManifestSha256,
        testId: generatedIssuePath, testSha256: actualTest ? sha256(actualTest.content) : "0".repeat(64), sequence, ref: "synthetic:receipt:" + parsed.value.receiptSha256 };
    };
    evidence.baseline = execute(baseline, "ISSUE", "BASELINE_ISSUE");
    if (!evidence.baseline || evidence.baseline.outcome !== "FAILED") return finish();
    if (scenario === "CANCEL_AFTER_BASELINE") { step("CANCELLED"); return finish(); }
    evidence.checks = [{ id: "regressions", baseline: execute(baseline, "REGRESSIONS", "BASELINE_REGRESSIONS"), patched: null }];
    if (evidence.checks[0]!.baseline?.outcome !== "PASSED" || errors.length) return finish();
    const patched = await preparePatch(frozen);
    if (!patched) return finish();
    evidence.patched = execute(patched, "ISSUE", "PATCHED_ISSUE");
    if (reconciliationRequired) return finish();
    evidence.checks[0]!.patched = execute(patched, "REGRESSIONS", "PATCHED_REGRESSIONS");
    return finish();

    async function preparePatch(frozen: FrozenTest): Promise<PreparedSnapshot | null> {
      patchAttempts++; evidence.patch = { sequence: step("PATCH_REQUESTED"), policy: "ALLOWED", ref: "synthetic:patch-proposal" };
      try {
        const proposal = await provider.generateSourcePatch(source, ["src/discount.mjs"]);
        const patched = prepareDiscountPatch(frozen, proposal.data.changes.map(change => ({ ...change, content: Buffer.from(change.content) })));
        if (!frozenTestsEquivalent(frozen, baseline, patched)) throw new Error("SYNTHETIC_FROZEN_MISMATCH");
        step("PATCH_PREPARED"); return patched;
      } catch { evidence.patch.policy = "PATCH_POLICY_VIOLATION"; errors.push("SYNTHETIC_PATCH_REJECTED"); return null; }
    }
  } catch { errors.push("SYNTHETIC_PREPARATION_REJECTED"); return finish(); }
}
