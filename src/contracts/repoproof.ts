import { z } from "zod";

export const RUN_STATES = [
  "CREATED",
  "ANALYZING",
  "AWAITING_APPROVAL",
  "QUEUED",
  "PREPARING",
  "GENERATING_REPRO",
  "BASELINING",
  "PATCHING",
  "VERIFYING",
  "REPORTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_RUN_STATES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

export type TerminalRunState = (typeof TERMINAL_RUN_STATES)[number];

export const VERIFICATION_VERDICTS = [
  "VERIFIED",
  "REJECTED",
  "NO_REPRO",
  "INCONCLUSIVE",
] as const;

export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export const REPRODUCER_ORIGINS = ["MODEL_GENERATED", "CURATED"] as const;

export type ReproducerOrigin = (typeof REPRODUCER_ORIGINS)[number];

export const TEST_PHASES = [
  "BASELINE_REPRO",
  "BASELINE_REGRESSION",
  "PATCHED_REPRO",
  "PATCHED_REGRESSION",
] as const;

export type TestPhase = (typeof TEST_PHASES)[number];

export const TEST_OUTCOMES = [
  "PASSED",
  "FAILED",
  "ERROR",
  "TIMEOUT",
  "SKIPPED",
  "NO_TESTS",
] as const;

export type TestOutcome = (typeof TEST_OUTCOMES)[number];

export const runStateSchema = z.enum(RUN_STATES);
export const verificationVerdictSchema = z.enum(VERIFICATION_VERDICTS);
export const reproducerOriginSchema = z.enum(REPRODUCER_ORIGINS);
export const testPhaseSchema = z.enum(TEST_PHASES);
export const testOutcomeSchema = z.enum(TEST_OUTCOMES);

export const baseShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "baseSha must be a 40-character lowercase hex SHA");

export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "sha256 must be a 64-character lowercase hex digest");

const terminalRunStates: ReadonlySet<RunState> = new Set(TERMINAL_RUN_STATES);

export function isTerminalRunState(state: RunState): boolean {
  return terminalRunStates.has(state);
}
