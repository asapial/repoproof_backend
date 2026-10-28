/**
 * Manual test script for getAiResponse()
 * Run with:  npx tsx src/scripts/testAiResponse.ts
 */

import { getAiResponse } from "../utils/aiResponse.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

function pass(label: string) {
  console.log(`${GREEN}${BOLD}  ✔ PASS${RESET}  ${label}`);
}
function fail(label: string, reason: unknown) {
  console.log(`${RED}${BOLD}  ✘ FAIL${RESET}  ${label}`);
  console.error("       Reason:", reason);
}
function section(title: string) {
  console.log(`\n${CYAN}${BOLD}━━━  ${title}  ━━━${RESET}`);
}

// ─────────────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────────────

/** Test 1 – Basic call with an explicit model */
async function testExplicitModel() {
  section("Test 1 — Explicit model, simple JSON response");

  const result = await getAiResponse<{ capital: string; country: string }>({
    context: "What is the capital city of France?",
    responseStyle:
      'Return a JSON object with exactly two keys: "capital" (string) and "country" (string).',
    aiModel: "google/gemma-4-31b-it:free",
    retryNumber: 2,
    responseTime: 10_000,
  });

  console.log(`  Model used : ${YELLOW}${result.model}${RESET}`);
  console.log(`  Success    : ${result.success}`);
  console.log(`  Data       :`, result.data);

  if (result.success && result.data && "capital" in result.data) {
    pass("Response contains expected 'capital' key");
  } else {
    fail("Response missing 'capital' key", result.error ?? result.rawText);
  }
}

/** Test 2 – No model provided → auto-cycle through free models */
async function testAutoModelCycle() {
  section("Test 2 — Auto model cycling (no aiModel specified)");

  const result = await getAiResponse<{
    steps: string[];
    difficulty: string;
  }>({
    context:
      "List the three basic steps to make a cup of tea, and rate the difficulty.",
    responseStyle:
      'Return JSON with keys: "steps" (array of strings, exactly 3 items) and "difficulty" ("easy" | "medium" | "hard").',
    retryNumber: 2,
    responseTime: 12_000,
  });

  console.log(`  Model used : ${YELLOW}${result.model}${RESET}`);
  console.log(`  Success    : ${result.success}`);
  console.log(`  Data       :`, JSON.stringify(result.data, null, 2));

  if (result.success && result.data && Array.isArray(result.data.steps)) {
    pass("Response contains 'steps' array");
  } else {
    fail("Response missing 'steps' key or not an array", result.error ?? result.rawText);
  }
}

/** Test 3 – restrictedAnswer is respected */
async function testRestrictedAnswer() {
  section("Test 3 — Restricted answer (no competitor names)");

  const result = await getAiResponse<{ answer: string }>({
    context:
      "Give me a one-sentence recommendation for the best JavaScript runtime.",
    responseStyle: 'Return JSON with one key: "answer" (string).',
    aiModel: "google/gemma-4-31b-it:free",
    restrictedAnswer:
      "Do not mention Bun, Deno, or any runtime other than Node.js",
    retryNumber: 2,
    responseTime: 10_000,
  });

  console.log(`  Model used : ${YELLOW}${result.model}${RESET}`);
  console.log(`  Success    : ${result.success}`);
  console.log(`  Data       :`, result.data);

  if (result.success && result.data) {
    pass("Got a response — manually verify no restricted words appear above");
  } else {
    fail("Failed to get a response", result.error ?? result.rawText);
  }
}

/** Test 4 – Timeout / failure behaviour (unreachable fake model) */
async function testRetryOnFailure() {
  section("Test 4 — Retry + graceful failure (bad model ID)");

  const result = await getAiResponse({
    context: "This should fail gracefully.",
    responseStyle: 'Return JSON with key: "ok" (boolean).',
    aiModel: "fake/nonexistent-model-xyz:free", // will always fail
    retryNumber: 2,
    responseTime: 4_000,
  });

  console.log(`  Success : ${result.success}`);
  console.log(`  Error   : ${result.error}`);

  if (!result.success && result.error) {
    pass("Gracefully failed and returned error message");
  } else {
    fail("Expected failure but got success", result.data);
  }
}

/** Test 5 – Complex structured response */
async function testComplexStructure() {
  section("Test 5 — Complex structured JSON");

  interface ProductReview {
    product: string;
    rating: number;
    pros: string[];
    cons: string[];
    verdict: string;
  }

  const result = await getAiResponse<ProductReview>({
    context:
      "Write a short product review for a fictional wireless keyboard called 'TypeMaster Pro'.",
    responseStyle: `Return JSON with keys:
- "product": string (product name)
- "rating": number (1–10)
- "pros": string[] (2–3 items)
- "cons": string[] (1–2 items)
- "verdict": string (one sentence summary)`,
    retryNumber: 2,
    responseTime: 15_000,
  });

  console.log(`  Model used : ${YELLOW}${result.model}${RESET}`);
  console.log(`  Success    : ${result.success}`);
  console.log(`  Data       :`, JSON.stringify(result.data, null, 2));

  if (
    result.success &&
    result.data &&
    typeof result.data.rating === "number" &&
    Array.isArray(result.data.pros)
  ) {
    pass("Complex structure returned with correct shape");
  } else {
    fail("Structure mismatch or failure", result.error ?? result.rawText);
  }
}

// ─────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────
async function runAllTests() {
  console.log(
    `${BOLD}${CYAN}\n╔══════════════════════════════════════╗`
  );
  console.log(`║    AI Response Utility — Test Suite  ║`);
  console.log(`╚══════════════════════════════════════╝${RESET}\n`);

  const tests = [
    testExplicitModel,
    testAutoModelCycle,
    testRestrictedAnswer,
    testRetryOnFailure,
    testComplexStructure,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      fail(`Unexpected exception in "${test.name}"`, err);
    }
  }

  console.log(`\n${CYAN}${BOLD}━━━  All tests complete  ━━━${RESET}\n`);
}

runAllTests();
