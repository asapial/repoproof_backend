import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { MetaAdapter } from "../utils/metaAdapter";
import { metaUsageSchema, type MetaAttempt, type MetaAccess } from "./access";
const key = "synthetic-metadata-key";
const model = "owned-test-model";
const limits = { maxInputBytes: 2048, maxOutputTokens: 128, timeoutMs: 20, maxRequests: 3, maxRetries: 1, maxCostPerAttemptUsd: 0.01, budgetUsd: 0.03 };
const request = { prompt: "Owned data", schemaName: "owned", jsonSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }, validator: z.object({ value: z.string() }).strict() };
const envelope = { id: "owned-response", model, choices: [{ finish_reason: "stop", message: { content: '{"value":"owned"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
function permission(attempt: MetaAttempt) { return { id: randomUUID(), requestSha256: attempt.requestSha256, model: attempt.model, billing: "ENFORCED_NO_CHARGE" as const, maxChargeUsd: 0 as const, expiresAt: Date.now() + 60000 }; }
beforeEach(() => vi.stubEnv("ENABLE_META", "true"));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("rejects a repeated reservation ID even for an identical request", async () => {
  const id = randomUUID(); const access = { reserve: async (attempt: MetaAttempt) => ({ ...permission(attempt), id }), record: async () => {} };
  const transport = vi.fn(async () => new Response(JSON.stringify(envelope)));
  const adapter = new MetaAdapter(limits, key, model, transport, access);
  await adapter.generate(request); await expect(adapter.generate(request)).rejects.toMatchObject({ code: "BUDGET_LIMIT" }); expect(transport).toHaveBeenCalledTimes(1);
});
it("accepts explicit zero estimates but still denies inference without enforced authorization", async () => {
  const transport = vi.fn();
  await expect(new MetaAdapter({ ...limits, budgetUsd: 0, maxCostPerAttemptUsd: 0 }, key, model, transport).generate(request)).rejects.toMatchObject({ code: "BUDGET_LIMIT" }); expect(transport).not.toHaveBeenCalled();
});
it("accounts cached input and reasoning as subsets without double-counting total", () => {
  const usage = { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } };
  expect(metaUsageSchema.parse(usage)).toEqual(usage);
  expect(metaUsageSchema.safeParse({ ...usage, prompt_tokens_details: { cached_tokens: 5 } }).success).toBe(false);
});
it("bounds unavailable/stalled authorization before any inference", async () => {
  for (const reserve of [async () => { throw new Error(key); }, () => new Promise<null>(() => {})]) {
    const transport = vi.fn(); const access = { reserve, record: async () => {} };
    const error = await new MetaAdapter(limits, key, model, transport, access).generate(request).catch(error => error);
    expect(["BUDGET_LIMIT", "TIMEOUT"]).toContain(error.code); expect(JSON.stringify(error)).not.toContain(key); expect(transport).not.toHaveBeenCalled();
  }
});
it("records a known rejected 429 and reserves another permission for retry", async () => {
  const access: MetaAccess = { reserve: vi.fn(async (attempt: MetaAttempt) => permission(attempt)), record: vi.fn(async () => {}) };
  const transport = vi.fn().mockResolvedValueOnce(new Response("private rejection", { status: 429, headers: { "retry-after": "0" } })).mockResolvedValueOnce(new Response(JSON.stringify(envelope)));
  const adapter = new MetaAdapter({ ...limits, timeoutMs: 2000, maxElapsedMs: 3000 }, key, model, transport, access);
  await adapter.generate(request); expect(access.reserve).toHaveBeenCalledTimes(2);
  expect(vi.mocked(access.record).mock.calls.map(call => call[0])).toEqual([expect.objectContaining({ outcome: "REJECTED", usage: null }), expect.objectContaining({ outcome: "RECEIVED", usage: envelope.usage })]);
});
it("bounds durable accounting without returning an unrecorded success", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
  const access: MetaAccess = { reserve: async attempt => permission(attempt), record: () => new Promise(() => {}) };
  const transport = vi.fn(async () => new Response(JSON.stringify(envelope)));
  const operation = new MetaAdapter(limits, key, model, transport, access).generate(request).catch(error => error);
  await vi.advanceTimersByTimeAsync(5001); expect((await operation).code).toBe("ACCOUNTING_UNAVAILABLE"); expect(transport).toHaveBeenCalledTimes(1);
});
it("keeps the old smoke entrypoint disabled even with its historical approval flag", async () => {
  vi.stubEnv("META_SMOKE_APPROVED", "yes"); vi.stubEnv("MODEL_API_KEY", key);
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  const log = vi.spyOn(console, "error").mockImplementation(() => {}); const priorExitCode = process.exitCode;
  try {
    await import("../scripts/metaSmoke"); expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith('{"status":"DISABLED","reason":"NO_VERIFIED_ZERO_CHARGE_ENTITLEMENT","requests":0,"retries":0}'); expect(transport).not.toHaveBeenCalled();
  } finally { process.exitCode = priorExitCode; vi.unstubAllGlobals(); }
});
