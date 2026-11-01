import { z } from "zod";

const endpoint = "https://api.meta.ai/v1/chat/completions";
const responseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  choices: z.array(z.object({ finish_reason: z.literal("stop"), message: z.object({ content: z.string().min(1) }) })).length(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative(), completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative() }).optional() }).refine((v) => v.total_tokens === v.prompt_tokens + v.completion_tokens && (v.completion_tokens_details?.reasoning_tokens ?? 0) <= v.completion_tokens).optional(),
});

export type MetaErrorCode = "NOT_CONFIGURED" | "INVALID_REQUEST" | "BUDGET_LIMIT" | "AUTHENTICATION" | "RATE_LIMIT" | "PROVIDER_ERROR" | "TIMEOUT" | "CANCELLED" | "NETWORK" | "INVALID_RESPONSE";
export type MetaResponseFailure = "JSON" | "TRUNCATED" | "ENVELOPE" | "MODEL" | "CONTENT" | "SECRET";
type SafeMetadata = { model?: string; finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | "function_call"; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; completion_tokens_details?: { reasoning_tokens: number } | undefined } };
export class MetaError extends Error {
  metadata?: SafeMetadata;
  constructor(public readonly code: MetaErrorCode, public readonly detail?: MetaResponseFailure) { super(`Meta API: ${code}`); }
}

export interface MetaLimits {
  maxInputBytes: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRequests: number;
  /** Operator estimate only; this is not a provider billing cap. */
  maxCostPerAttemptUsd: number;
  budgetUsd: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  maxElapsedMs?: number;
}

export interface MetaRequest<T> {
  prompt: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  signal?: AbortSignal;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("aborted")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new MetaError("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new MetaError("INVALID_RESPONSE");
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

function retryDelay(value: string | null, attempt: number): number | null {
  let minimum = 0;
  if (value) {
    const seconds = Number(value);
    minimum = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - Date.now();
    if (!Number.isFinite(minimum)) return null;
    if (minimum < 0) minimum = 0;
  }
  const delay = Math.max(minimum, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
  return delay <= 30000 ? delay : null;
}

function containsSecret(value: unknown, secret: string): boolean {
  if (typeof value === "string") return value.includes(secret);
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, secret));
  if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => key.includes(secret) || containsSecret(item, secret));
  return false;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new MetaError("CANCELLED")); return; }
    const done = () => { signal?.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(new MetaError("CANCELLED")); };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/** One instance owns one in-memory budget. Use external accounting for distributed workers. */
export class MetaAdapter {
  private attempts = 0;
  constructor(private readonly limits: MetaLimits, private readonly apiKey = process.env.MODEL_API_KEY, private readonly model = process.env.META_MODEL_ID || "muse-spark-1.3", private readonly transport: typeof fetch = fetch) {
    if (!z.object({ maxInputBytes: z.number().int().positive().max(1000000), maxOutputTokens: z.number().int().positive().max(4096), timeoutMs: z.number().int().positive().max(120000), maxRequests: z.number().int().positive().max(100), maxCostPerAttemptUsd: z.number().finite().positive(), budgetUsd: z.number().finite().positive(), maxRetries: z.number().int().min(0).max(2).optional(), maxResponseBytes: z.number().int().positive().max(1000000).optional(), maxElapsedMs: z.number().int().positive().max(420000).optional() }).safeParse(limits).success) throw new MetaError("INVALID_REQUEST");
    this.limits = { ...limits };
  }

  async generate<T>(request: MetaRequest<T>): Promise<{ data: T; metadata: { id: string; model: string; latencyMs: number; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } } }> {
    if (process.env.ENABLE_META !== "true" || !this.apiKey?.trim()) throw new MetaError("NOT_CONFIGURED");
    if (!z.object({ prompt: z.string().trim().min(1), schemaName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), jsonSchema: z.object({ type: z.literal("object"), properties: z.record(z.string(), z.unknown()), required: z.array(z.string()), additionalProperties: z.literal(false) }).passthrough(), validator: z.instanceof(z.ZodType), reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).optional() }).safeParse(request).success || !/^[A-Za-z0-9._-]{1,128}$/.test(this.model)) throw new MetaError("INVALID_REQUEST");
    let body: string;
    try {
      body = JSON.stringify({ model: this.model, messages: [{ role: "user", content: request.prompt }], max_completion_tokens: this.limits.maxOutputTokens, ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}), response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema } } });
    } catch { throw new MetaError("INVALID_REQUEST"); }
    if (Buffer.byteLength(body, "utf8") > this.limits.maxInputBytes || containsSecret(JSON.parse(body), this.apiKey)) throw new MetaError("INVALID_REQUEST");
    if (request.signal?.aborted) throw new MetaError("CANCELLED");
    const deadline = Date.now() + (this.limits.maxElapsedMs ?? (this.limits.timeoutMs * ((this.limits.maxRetries ?? 0) + 1) + 30000 * (this.limits.maxRetries ?? 0)));
    for (let retry = 0; ; retry++) {
    if (Date.now() >= deadline) throw new MetaError("TIMEOUT");
    if (this.attempts >= this.limits.maxRequests || (this.attempts + 1) * this.limits.maxCostPerAttemptUsd > this.limits.budgetUsd) throw new MetaError("BUDGET_LIMIT");
    this.attempts++;
    const start = Date.now();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.min(this.limits.timeoutMs, Math.max(1, deadline - Date.now())));
    try {
      let response: Response;
      try {
        const pending = this.transport(endpoint, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body, signal: controller.signal });
        void pending.then((late) => { if (controller.signal.aborted) void late.body?.cancel().catch(() => {}); }, () => {});
        response = await abortable(pending, controller.signal);
        if (controller.signal.aborted) throw new Error("aborted");
      }
      catch { throw new MetaError(request.signal?.aborted ? "CANCELLED" : controller.signal.aborted ? "TIMEOUT" : "NETWORK"); }
      if (!response.ok) {
        const delay = response.status === 429 && retry < (this.limits.maxRetries ?? 0) ? retryDelay(response.headers.get("retry-after"), retry) : null;
        void response.body?.cancel().catch(() => {});
        if (delay !== null) { if (delay >= deadline - Date.now()) throw new MetaError("TIMEOUT"); clearTimeout(timer); await wait(delay, request.signal); continue; }
        throw new MetaError(response.status === 401 || response.status === 403 ? "AUTHENTICATION" : response.status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR");
      }
      let raw: string;
      try { raw = await readBounded(response, this.limits.maxResponseBytes ?? 1000000, controller.signal); } catch (error) { if (error instanceof MetaError) throw error; throw new MetaError(request.signal?.aborted ? "CANCELLED" : controller.signal.aborted ? "TIMEOUT" : "NETWORK"); }
      if (controller.signal.aborted) throw new MetaError(request.signal?.aborted ? "CANCELLED" : "TIMEOUT");
      if (raw.includes(this.apiKey)) throw new MetaError("INVALID_RESPONSE", "SECRET");
      const safe: SafeMetadata = {};
      try {
        let decoded: unknown;
        try { decoded = JSON.parse(raw); } catch { throw new MetaError("INVALID_RESPONSE", "JSON"); }
        if (containsSecret(decoded, this.apiKey)) throw new MetaError("INVALID_RESPONSE", "SECRET");
        const safeSchema = z.object({ model: z.string().optional(), choices: z.array(z.object({ finish_reason: z.enum(["stop", "length", "tool_calls", "content_filter", "function_call"]) })).length(1).optional(), usage: responseSchema.shape.usage });
        const info = safeSchema.safeParse(decoded);
        if (info.success) {
          if (info.data.model === this.model && !info.data.model.includes(this.apiKey)) safe.model = this.model;
          const finish = info.data.choices?.[0]?.finish_reason;
          if (finish) safe.finishReason = finish;
          if (info.data.usage) safe.usage = info.data.usage;
        }
        const termination = z.object({ choices: z.array(z.object({ finish_reason: z.string() })).length(1) }).safeParse(decoded);
        if (termination.success && termination.data.choices[0]?.finish_reason === "length") throw new MetaError("INVALID_RESPONSE", "TRUNCATED");
        const envelope = responseSchema.safeParse(decoded);
        if (!envelope.success) throw new MetaError("INVALID_RESPONSE", "ENVELOPE");
        const parsed = envelope.data;
        if (parsed.model !== this.model) throw new MetaError("INVALID_RESPONSE", "MODEL");
        if (JSON.stringify(parsed).includes(this.apiKey)) throw new MetaError("INVALID_RESPONSE", "SECRET");
        let data: T;
        try { data = request.validator.parse(JSON.parse(parsed.choices[0]!.message.content)); } catch { throw new MetaError("INVALID_RESPONSE", "CONTENT"); }
        if (containsSecret(data, this.apiKey)) throw new MetaError("INVALID_RESPONSE", "SECRET");
        return { data, metadata: { id: parsed.id, model: parsed.model, latencyMs: Date.now() - start, ...(parsed.usage ? { usage: parsed.usage } : {}) } };
      } catch (error) { if (error instanceof MetaError) { if (error.detail !== "SECRET") error.metadata = safe; throw error; } throw new MetaError("INVALID_RESPONSE"); }
    } finally { clearTimeout(timer); request.signal?.removeEventListener("abort", cancel); }
    }
  }
}
