import { z } from "zod";
import { MetaError, abortable, readBounded } from "../utils/metaAdapter";

export const metaCatalogSchema = z.object({ object: z.literal("list"), data: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/), object: z.literal("model"), created: z.number().int().nonnegative().safe(), owned_by: z.string().min(1).max(200) })).max(200) });
export type MetaCatalog = z.infer<typeof metaCatalogSchema>;
export class MetaCatalogClient {
  #apiKey: string | undefined;
  constructor(apiKey: string | undefined, private readonly readAuthorized: () => Promise<boolean> = async () => false,
    private readonly transport: typeof fetch = fetch, private readonly timeoutMs = 5000) {
    this.#apiKey = apiKey;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new MetaError("INVALID_REQUEST");
  }
  toJSON() { return { provider: "meta-catalog", configured: Boolean(this.#apiKey) }; }
  async list(cancellation?: AbortSignal): Promise<MetaCatalog> {
    if (process.env.ENABLE_META !== "true" || !this.#apiKey?.trim()) throw new MetaError("NOT_CONFIGURED");
    if (cancellation?.aborted) throw new MetaError("CANCELLED");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([timeout, ...(cancellation ? [cancellation] : [])]);
    try {
      if (!(await abortable(this.readAuthorized(), signal))) throw new MetaError("BUDGET_LIMIT");
      const pending = this.transport("https://api.meta.ai/v1/models", { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: "application/json" }, signal });
      void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
      const response = await abortable(pending, signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new MetaError(response.status === 401 || response.status === 403 ? "AUTHENTICATION" : response.status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR");
      }
      const raw = await readBounded(response, 65536, signal);
      const decoded: unknown = JSON.parse(raw);
      // Canonical JSON also catches credentials escaped in response strings.
      if (raw.includes(this.#apiKey) || JSON.stringify(decoded).includes(JSON.stringify(this.#apiKey).slice(1, -1))) throw new MetaError("INVALID_RESPONSE", "SECRET");
      const parsed = metaCatalogSchema.safeParse(decoded);
      if (!parsed.success || new Set(parsed.data.data.map(item => item.id)).size !== parsed.data.data.length) throw new MetaError("INVALID_RESPONSE");
      return parsed.data;
    } catch (error) {
      if (cancellation?.aborted) throw new MetaError("CANCELLED");
      if (signal.aborted) throw new MetaError("TIMEOUT");
      if (error instanceof MetaError) throw error;
      throw new MetaError(error instanceof SyntaxError ? "INVALID_RESPONSE" : "NETWORK");
    }
  }
}
