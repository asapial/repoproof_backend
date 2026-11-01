import { z } from "zod";
import { createHash } from "node:crypto";
import { MetaAdapter, MetaError } from "../utils/metaAdapter";
import { type MetaCatalogClient } from "./catalog";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.string().regex(/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:js|mjs|ts)$/).max(240);
const patchPathAllowed = (value: string) => path.safeParse(value).success && !/(?:^|\/)(?:tests?|__tests__|node_modules|runner|sandbox|isolation|execution|verification|meta|config|contracts|scripts)(?:\/|$)/i.test(value) && !/(?:^|\/)(?:metaAdapter|runnerPolicy|fixturePolicy|secrets?|credentials?|regressions?)\.(?:js|mjs|ts)$/i.test(value);
export const modelSourceSchema = z.object({ baseSha: z.string().regex(/^[a-f0-9]{40}$/), issue: z.object({ number: z.number().int().positive(), title: z.string().min(1).max(500), body: z.string().min(1).max(16000) }).strict(), files: z.array(z.object({ path, content: z.string().max(16000), sha256: sha }).strict()).min(1).max(8) }).strict();
export type ModelSource = z.infer<typeof modelSourceSchema>;
export const issueAnalysisSchema = z.object({ summary: z.string().min(1).max(2000), relevantPaths: z.array(path).min(1).max(8), reproducibleHypothesis: z.string().min(1).max(2000) }).strict();
export const generatedRegressionSchema = z.object({ path: z.literal("tests/issue.generated.mjs"), content: z.string().min(1).max(24000), assertionPurpose: z.string().min(1).max(1000) }).strict();
export const generatedPatchSchema = z.object({ baseSha: z.string().regex(/^[a-f0-9]{40}$/), changes: z.array(z.object({ path, previousSha256: sha, content: z.string().max(16000) }).strict()).min(1).max(4), explanation: z.string().min(1).max(2000) }).strict();
type Generator = Pick<MetaAdapter, "generate">;
type Catalog = Pick<MetaCatalogClient, "list">;

// Provider capabilities only. No orchestration/triage invocation, filesystem
// writes, patch application, execution or verdict decision occurs in this layer.
export class MetaTaskProvider {
  constructor(private readonly model: string, private readonly catalog: Catalog, private readonly adapter: Generator) {}
  private async generate<T>(task: string, source: ModelSource, validator: z.ZodType<T>, signal?: AbortSignal, allowedPaths?: readonly string[]) {
    let parsed: ModelSource;
    try { parsed = modelSourceSchema.parse(source); } catch { throw new MetaError("INVALID_REQUEST"); }
    if (new Set(parsed.files.map(file => file.path)).size !== parsed.files.length || parsed.files.some(file => createHash("sha256").update(file.content, "utf8").digest("hex") !== file.sha256)) throw new MetaError("INVALID_REQUEST");
    if (allowedPaths && (allowedPaths.length === 0 || allowedPaths.length > 4 || new Set(allowedPaths).size !== allowedPaths.length || allowedPaths.some(value => !patchPathAllowed(value) || !parsed.files.some(file => file.path === value)))) throw new MetaError("INVALID_REQUEST");
    const prompt = JSON.stringify({ task, trust: "DATA_ONLY", source: parsed, ...(allowedPaths ? { allowedSourcePaths: allowedPaths } : {}) });
    if (Buffer.byteLength(prompt, "utf8") > 65536) throw new MetaError("INVALID_REQUEST");
    const available = await this.catalog.list(signal);
    if (!available.data.some(item => item.id === this.model)) throw new MetaError("INVALID_REQUEST");
    // No inference model fallback. Catalog and selected model are server inputs.
    const response = await this.adapter.generate({ prompt, schemaName: task, jsonSchema: z.toJSONSchema(validator), validator, ...(signal ? { signal } : {}) });
    if (response.metadata.model !== this.model || !response.metadata.usage) throw new MetaError("INVALID_RESPONSE");
    return { response, snapshot: parsed };
  }
  async analyzeIssue(source: ModelSource, signal?: AbortSignal) {
    const { response, snapshot } = await this.generate("issue_analysis", source, issueAnalysisSchema, signal);
    if (response.data.relevantPaths.some(path => !snapshot.files.some(file => file.path === path))) throw new MetaError("INVALID_RESPONSE");
    return response;
  }
  async generateRegressionTest(source: ModelSource, signal?: AbortSignal) { return (await this.generate("regression_test", source, generatedRegressionSchema, signal)).response; }
  async generateSourcePatch(source: ModelSource, allowedSourcePaths: readonly string[], signal?: AbortSignal) {
    const allowed = [...allowedSourcePaths];
    const { response, snapshot } = await this.generate("source_patch", source, generatedPatchSchema, signal, allowed);
    if (response.data.baseSha !== snapshot.baseSha || new Set(response.data.changes.map(item => item.path)).size !== response.data.changes.length || response.data.changes.some(item => !allowed.includes(item.path) || snapshot.files.find(file => file.path === item.path)?.sha256 !== item.previousSha256)) throw new MetaError("INVALID_RESPONSE");
    return response;
  }
}
