import { envVars } from "../config/env";

// ─────────────────────────────────────────────
// Free models available via OpenRouter
// ─────────────────────────────────────────────
const FREE_MODELS: string[] = [
  "openrouter/owl-alpha",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-m.1:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
  "poolside/laguna-xs.2:free",
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/llama-nemotron-embed-vl-1b-v2:free",
];

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface AiRequestParams {
  /** The main context / question to send to the AI */
  context: string;
  /**
   * Describe the shape and style of the expected response.
   * e.g. `"Return a JSON object with keys: title, summary, tags"`
   */
  responseStyle: string;
  /** How many times to retry on failure per model (default: 2) */
  retryNumber?: number;
  /**
   * Specific OpenRouter model ID to use.
   * If omitted, the function cycles through FREE_MODELS automatically.
   */
  aiModel?: string;
  /**
   * Topics / content the AI must NOT discuss.
   * e.g. `"Do not include any pricing information or competitor names"`
   */
  restrictedAnswer?: string;
  /** Per-request timeout in milliseconds (default: 5000 ms) */
  responseTime?: number;
}

export interface AiResponse<T = unknown> {
  success: boolean;
  model: string;
  data: T | null;
  /** Raw text returned by the AI if JSON parsing failed */
  rawText?: string;
  error?: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Build the system prompt that enforces JSON output and restrictions */
function buildSystemPrompt(
  responseStyle: string,
  restrictedAnswer?: string
): string {
  const lines: string[] = [
    "You are a precise AI assistant. Always respond with valid JSON only — no markdown fences, no extra text.",
    `Response format / style: ${responseStyle}`,
  ];

  if (restrictedAnswer && restrictedAnswer.trim()) {
    lines.push(`Restrictions — strictly avoid: ${restrictedAnswer.trim()}`);
  }

  return lines.join("\n");
}

/** Attempt a single fetch call with an AbortController timeout */
async function fetchFromModel(
  model: string,
  systemPrompt: string,
  userMessage: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${envVars.OpenRouter_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `HTTP ${response.status} from model "${model}": ${errorBody}`
      );
    }

    const json = await response.json();
    const content: string =
      json?.choices?.[0]?.message?.content ?? "";

    if (!content) {
      throw new Error(`Empty content returned by model "${model}"`);
    }

    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Try to parse a string as JSON, stripping markdown fences if present */
function safeParseJson<T>(raw: string): T | null {
  try {
    // Strip possible ```json ... ``` fences
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Main exported function
// ─────────────────────────────────────────────

/**
 * Fetches an AI-generated JSON response from OpenRouter.
 *
 * - If `aiModel` is provided, only that model is tried.
 * - If `aiModel` is omitted, the function iterates through FREE_MODELS until
 *   one succeeds.
 * - Each model attempt is retried up to `retryNumber` times before moving on.
 * - Every request is cancelled if it exceeds `responseTime` milliseconds.
 *
 * @returns An {@link AiResponse} object. `data` is the parsed JSON value; if
 *          JSON parsing fails, `rawText` holds the raw AI output.
 */
export async function getAiResponse<T = unknown>(
  params: AiRequestParams
): Promise<AiResponse<T>> {
  const {
    context,
    responseStyle,
    retryNumber = 2,
    aiModel,
    restrictedAnswer = "",
    responseTime = 5000,
  } = params;

  const systemPrompt = buildSystemPrompt(responseStyle, restrictedAnswer);
  const modelsToTry: string[] = aiModel ? [aiModel] : FREE_MODELS;

  let lastError = "Unknown error";

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= retryNumber; attempt++) {
      try {
        console.log(
          `[AI] Trying model "${model}" — attempt ${attempt}/${retryNumber}`
        );

        const rawText = await fetchFromModel(
          model,
          systemPrompt,
          context,
          responseTime
        );

        const parsed = safeParseJson<T>(rawText);

        if (parsed !== null) {
          return {
            success: true,
            model,
            data: parsed,
          };
        }

        // JSON parse failed — return raw text so the caller can decide
        console.warn(
          `[AI] Model "${model}" returned non-JSON output. Returning rawText.`
        );
        return {
          success: true,
          model,
          data: null,
          rawText,
        };
      } catch (err: unknown) {
        lastError =
          err instanceof Error ? err.message : String(err);

        console.error(
          `[AI] Model "${model}" attempt ${attempt} failed: ${lastError}`
        );

        // If we still have retries left, wait briefly before retrying
        if (attempt < retryNumber) {
          await new Promise((res) => setTimeout(res, 500 * attempt));
        }
      }
    }

    console.warn(`[AI] All ${retryNumber} attempts failed for "${model}". Moving to next model.`);
  }

  // All models and retries exhausted
  return {
    success: false,
    model: modelsToTry[modelsToTry.length - 1],
    data: null,
    error: `All models failed. Last error: ${lastError}`,
  };
}
