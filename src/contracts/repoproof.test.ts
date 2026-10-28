import { describe, expect, it } from "vitest";
import {
  RUN_STATES,
  TERMINAL_RUN_STATES,
  TEST_OUTCOMES,
  TEST_PHASES,
  VERIFICATION_VERDICTS,
  baseShaSchema,
  isTerminalRunState,
  reproducerOriginSchema,
  runStateSchema,
  testOutcomeSchema,
  testPhaseSchema,
  sha256Schema,
  verificationVerdictSchema,
} from "./repoproof";

describe("run state contract", () => {
  it("contains exactly the documented states", () => {
    expect(RUN_STATES).toEqual([
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
    ]);
  });

  it("marks only COMPLETED, FAILED and CANCELLED as terminal", () => {
    expect(TERMINAL_RUN_STATES).toEqual(["COMPLETED", "FAILED", "CANCELLED"]);
    expect(isTerminalRunState("COMPLETED")).toBe(true);
    expect(isTerminalRunState("FAILED")).toBe(true);
    expect(isTerminalRunState("CANCELLED")).toBe(true);
    expect(isTerminalRunState("QUEUED")).toBe(false);
    expect(isTerminalRunState("VERIFYING")).toBe(false);
  });
});

describe("verdict contract", () => {
  it("contains exactly the four deterministic verdicts", () => {
    expect(VERIFICATION_VERDICTS).toEqual([
      "VERIFIED",
      "REJECTED",
      "NO_REPRO",
      "INCONCLUSIVE",
    ]);
  });

  it("rejects verdicts outside the contract", () => {
    expect(verificationVerdictSchema.safeParse("VERIFIED").success).toBe(true);
    expect(verificationVerdictSchema.safeParse("FIXED").success).toBe(false);
    expect(verificationVerdictSchema.safeParse("verified").success).toBe(false);
    expect(runStateSchema.safeParse("DONE").success).toBe(false);
  });
});

describe("evidence identifiers", () => {
  it("accepts only exact 40-character lowercase hex base SHAs", () => {
    expect(baseShaSchema.safeParse("0123456789abcdef0123456789abcdef01234567").success).toBe(true);
    expect(baseShaSchema.safeParse("main").success).toBe(false);
    expect(baseShaSchema.safeParse("0123456789ABCDEF0123456789abcdef01234567").success).toBe(false);
    expect(baseShaSchema.safeParse("0123456789abcdef0123456789abcdef0123456").success).toBe(false);
  });

  it("accepts only exact 64-character lowercase hex SHA-256 digests", () => {
    expect(sha256Schema.safeParse("a".repeat(64)).success).toBe(true);
    expect(sha256Schema.safeParse("a".repeat(63)).success).toBe(false);
    expect(sha256Schema.safeParse("A".repeat(64)).success).toBe(false);
  });

  it("keeps test phases and outcomes aligned with the evidence schema", () => {
    expect(TEST_PHASES).toEqual([
      "BASELINE_REPRO",
      "BASELINE_REGRESSION",
      "PATCHED_REPRO",
      "PATCHED_REGRESSION",
    ]);
    expect(TEST_OUTCOMES).toEqual([
      "PASSED",
      "FAILED",
      "ERROR",
      "TIMEOUT",
      "SKIPPED",
      "NO_TESTS",
    ]);
  });
});


describe("contract runtime validation", () => {
  it("rejects invalid evidence enum values and non-strings", () => {
    for (const schema of [runStateSchema, verificationVerdictSchema, reproducerOriginSchema, testPhaseSchema, testOutcomeSchema]) {
      expect(schema.safeParse("").success).toBe(false);
      expect(schema.safeParse(null).success).toBe(false);
      expect(schema.safeParse(123).success).toBe(false);
    }
    expect(reproducerOriginSchema.safeParse("EXTERNAL").success).toBe(false);
    expect(testPhaseSchema.safeParse("PATCHED").success).toBe(false);
    expect(testOutcomeSchema.safeParse("VERIFIED").success).toBe(false);
  });

  it("rejects malformed digest types and characters", () => {
    expect(baseShaSchema.safeParse(null).success).toBe(false);
    expect(baseShaSchema.safeParse("g".repeat(40)).success).toBe(false);
    expect(sha256Schema.safeParse(123).success).toBe(false);
    expect(sha256Schema.safeParse("z".repeat(64)).success).toBe(false);
  });
});
