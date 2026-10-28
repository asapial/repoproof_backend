import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MetaAdapter } from "./metaAdapter";

const limits = { maxInputBytes: 10000, maxOutputTokens: 40, timeoutMs: 20, maxRequests: 2, maxCostPerAttemptUsd: 0.01, budgetUsd: 0.02 };
const request = { prompt: "Say hello", schemaName: "Greeting", jsonSchema: { type: "object", properties: { greeting: { type: "string" } }, required: ["greeting"], additionalProperties: false }, validator: z.object({ greeting: z.string() }).strict() };
const envelope = { id: "id", model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content: '{"greeting":"hello"}' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
const ok = () => new Response(JSON.stringify(envelope), { status: 200 });

describe("MetaAdapter", () => {
  it("validates structured output and metadata", async () => {
    const transport = vi.fn().mockResolvedValue(ok());
    const result = await new MetaAdapter(limits, "secret", undefined, transport).generate(request);
    expect(result.data).toEqual({ greeting: "hello" });
    expect(result.metadata.usage?.total_tokens).toBe(5);
    expect(transport.mock.calls[0]?.[0]).toBe("https://api.meta.ai/v1/chat/completions");
  });
  it.each([{}, { ...envelope, choices: [] }, { ...envelope, choices: [{ message: { content: '{}' } }] }])("rejects malformed or incomplete responses", async (body) => {
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects missing credentials without calling provider", async () => {
    const transport = vi.fn();
    await expect(new MetaAdapter(limits, "", undefined, transport).generate(request)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([[401, "AUTHENTICATION"], [403, "AUTHENTICATION"], [429, "RATE_LIMIT"], [500, "PROVIDER_ERROR"]])("maps HTTP %i without exposing provider text", async (status, code) => {
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response("secret", { status })));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code, message: `Meta API: ${code}` });
  });
  it("reports network errors without exposing their message", async () => {
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockRejectedValue(new Error("secret")));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "NETWORK", message: "Meta API: NETWORK" });
  });
  it("reports timeouts", async () => {
    const transport: typeof fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(new MetaAdapter(limits, "secret", undefined, transport).generate(request)).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("reserves budget for every attempt and does not retry", async () => {
    const transport = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    const adapter = new MetaAdapter({ ...limits, budgetUsd: 0.01 }, "secret", undefined, transport);
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "RATE_LIMIT" });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "BUDGET_LIMIT" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects a provider response containing the credential", async () => {
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...envelope, id: "secret" }))));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([{ ...envelope, choices: [{ ...envelope.choices[0], finish_reason: "length" }] }, { ...envelope, usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 1 } }])("rejects truncated output and inconsistent usage", async (body) => {
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("bounds streaming response bytes", async () => {
    const adapter = new MetaAdapter({ ...limits, maxResponseBytes: 10 }, "secret", undefined, vi.fn().mockResolvedValue(ok()));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("retries only a rejected rate limit within the configured limit", async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } })).mockResolvedValueOnce(ok());
    const adapter = new MetaAdapter({ ...limits, maxRetries: 1 }, "secret", undefined, transport);
    await expect(adapter.generate(request)).resolves.toMatchObject({ data: { greeting: "hello" } });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does not retry ambiguous network failures", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("secret"));
    await expect(new MetaAdapter({ ...limits, maxRetries: 2 }, "secret", undefined, transport).generate(request)).rejects.toMatchObject({ code: "NETWORK" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("honors cancellation before a request", async () => {
    const controller = new AbortController(); controller.abort();
    const transport = vi.fn();
    await expect(new MetaAdapter(limits, "secret", undefined, transport).generate({ ...request, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not retry when Retry-After exceeds the delay limit", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    await expect(new MetaAdapter({ ...limits, maxRetries: 2 }, "secret", undefined, transport).generate(request)).rejects.toMatchObject({ code: "RATE_LIMIT" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("cancels during retry backoff without another request", async () => {
    const controller = new AbortController();
    const transport = vi.fn().mockImplementation(async () => {
      setTimeout(() => controller.abort(), 10);
      return new Response(null, { status: 429 });
    });
    await expect(new MetaAdapter({ ...limits, maxRetries: 1 }, "secret", undefined, transport).generate({ ...request, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("sends the completion token cap and disables redirects", async () => {
    const transport = vi.fn().mockResolvedValue(ok());
    await new MetaAdapter(limits, "secret", undefined, transport).generate(request);
    const options = transport.mock.calls[0]?.[1];
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body).max_completion_tokens).toBe(40);
  });
  it("sends the explicitly configured reasoning effort", async () => {
    const transport = vi.fn().mockResolvedValue(ok());
    await new MetaAdapter(limits, "secret", undefined, transport).generate({ ...request, reasoningEffort: "minimal" });
    expect(JSON.parse(transport.mock.calls[0]?.[1].body).reasoning_effort).toBe("minimal");
  });
  it("accepts responses without usage metadata", async () => {
    const body = { ...envelope, usage: undefined };
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(adapter.generate(request)).resolves.toMatchObject({ data: { greeting: "hello" } });
  });
  it.each(["timeout", "cancel"])("stops a stalled body on %s and cancels its reader", async (mode) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel });
    const controller = new AbortController();
    const adapter = new MetaAdapter({ ...limits, timeoutMs: 40 }, "secret", undefined, vi.fn().mockResolvedValue(new Response(stream)));
    const pending = adapter.generate({ ...request, signal: controller.signal });
    if (mode === "cancel") setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: mode === "cancel" ? "CANCELLED" : "TIMEOUT" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("classifies a partial stream failure as a network error", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); c.error(new Error("secret")); } });
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(stream)));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "NETWORK", message: "Meta API: NETWORK" });
  });
  it("rejects late responses after timeout", async () => {
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(ok()), 50))));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("does not retry malformed Retry-After", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "invalid" } }));
    await expect(new MetaAdapter({ ...limits, maxRetries: 1 }, "secret", undefined, transport).generate(request)).rejects.toMatchObject({ code: "RATE_LIMIT" });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("isolates limits from subsequent mutation", async () => {
    const options = { ...limits, maxRequests: 1 };
    const adapter = new MetaAdapter(options, "secret", undefined, vi.fn().mockImplementation(async () => ok()));
    options.maxRequests = 100;
    await adapter.generate(request);
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "BUDGET_LIMIT" });
  });
  it("enforces a total deadline before retry backoff", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    const adapter = new MetaAdapter({ ...limits, maxRetries: 1, maxElapsedMs: 100 }, "secret", undefined, transport);
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("rejects secrets even when JSON escaping changes their representation", async () => {
    const transport = vi.fn();
    const adapter = new MetaAdapter(limits, 'a"b', undefined, transport);
    await expect(adapter.generate({ ...request, prompt: 'a"b' })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("reports a sanitized truncation category", async () => {
    const body = { ...envelope, choices: [{ finish_reason: "length", message: { content: "sensitive" } }] };
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE", detail: "TRUNCATED", message: "Meta API: INVALID_RESPONSE" });
  });
  it("retains safe metadata for truncated responses without exposing content", async () => {
    const body = { ...envelope, usage: { ...envelope.usage, completion_tokens_details: { reasoning_tokens: 1 } }, choices: [{ finish_reason: "length", message: { content: "private-output" } }] };
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const error = await adapter.generate(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ detail: "TRUNCATED", metadata: { model: "muse-spark-1.3", finishReason: "length", usage: { completion_tokens_details: { reasoning_tokens: 1 } } } });
    expect(JSON.stringify(error)).not.toContain("private-output");
  });
  it("does not retain metadata from a response containing the credential", async () => {
    const body = { ...envelope, choices: [{ finish_reason: "length", message: { content: "secret" } }] };
    const adapter = new MetaAdapter(limits, "secret", undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(adapter.generate(request)).rejects.toMatchObject({ detail: "SECRET" });
  });
  it("rejects a credential escaped inside nested structured output", async () => {
    const key = 'a"b';
    const body = { ...envelope, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ greeting: key }) } }] };
    const adapter = new MetaAdapter(limits, key, undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE", detail: "SECRET" });
  });
});
