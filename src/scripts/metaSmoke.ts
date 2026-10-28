import { config } from "dotenv";
import { z } from "zod";
import { MetaAdapter, MetaError } from "../utils/metaAdapter";

let requests = 0;
let status: number | undefined;
let started: number | undefined;
const transport: typeof fetch = async (url, options) => {
  if (requests !== 0) throw new Error("Request limit exceeded");
  requests++;
  started = Date.now();
  const response = await fetch(url, options);
  status = response.status;
  return response;
};

// This script requires separate user authorization before it is executed.
async function main(): Promise<void> {
  if (process.env.META_SMOKE_APPROVED !== "yes") throw new Error("Explicit smoke-test approval required");
  const loaded = config({ path: ".env", override: false, quiet: true });
  if (loaded.error || !loaded.parsed?.MODEL_API_KEY?.trim()) throw new Error("MODEL_API_KEY missing from .env");
  const adapter = new MetaAdapter({ maxInputBytes: 2048, maxOutputTokens: 512, timeoutMs: 30000, maxRequests: 1, maxRetries: 0, maxResponseBytes: 16384, maxCostPerAttemptUsd: 0.05, budgetUsd: 0.05 }, loaded.parsed.MODEL_API_KEY, "muse-spark-1.3", transport);
  const result = await adapter.generate({ prompt: "Return hello.", reasoningEffort: "minimal", schemaName: "Greeting", jsonSchema: { type: "object", properties: { greeting: { type: "string" } }, required: ["greeting"], additionalProperties: false }, validator: z.object({ greeting: z.string().max(100) }).strict() });
  console.log(JSON.stringify({ requests, retries: 0, status, metadata: result.metadata, valid: true }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ requests, retries: 0, status: status ?? null, latencyMs: started === undefined ? null : Date.now() - started, error: error instanceof MetaError ? error.code : "START_FAILED", detail: error instanceof MetaError ? error.detail : undefined, metadata: error instanceof MetaError ? error.metadata : undefined }));
  process.exitCode = 1;
});
