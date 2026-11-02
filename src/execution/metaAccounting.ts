import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import { z } from "zod";
import { metaUsageSchema } from "../meta/access";
import type { JobResult } from "./jobs";

const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe();
// Close the provider's extensible usage envelope at this persistence boundary.
const usageSchema = z.object({ prompt_tokens: count, completion_tokens: count, total_tokens: count,
  prompt_tokens_details: z.object({ cached_tokens: count }).strict().optional(),
  completion_tokens_details: z.object({ reasoning_tokens: count }).strict().optional() }).strict().pipe(metaUsageSchema);
export const metaAccountingAttemptSchema = z.object({ effectId: uuid, jobId: uuid, jobVersion: count.max(2147483647),
  requestHash: digest, model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  maxOutputTokens: z.number().int().min(1).max(65536), source: z.enum(["OFFLINE_SYNTHETIC", "LIVE_UNVERIFIED"]) }).strict();
export const metaAccountingObservationSchema = z.object({ effectId: uuid,
  outcome: z.enum(["RECEIVED", "REJECTED", "UNCERTAIN"]), usage: usageSchema.nullable() }).strict();
export type MetaAccountingAttempt = z.infer<typeof metaAccountingAttemptSchema>;
export type MetaAccountingObservation = z.infer<typeof metaAccountingObservationSchema>;
export type MetaAccountingRecord = Readonly<{ attempt: MetaAccountingAttempt; observation: MetaAccountingObservation | null;
  dispatchAllowed: false; noChargeEntitlementVerified: false; independentReviewRequired: true; outputLimitExceeded: boolean }>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const attemptHash = (a: MetaAccountingAttempt) => hash({ version: "rpf-meta-attempt-v1", effectId: a.effectId, jobId: a.jobId,
  jobVersion: a.jobVersion, requestHash: a.requestHash, model: a.model, maxOutputTokens: a.maxOutputTokens, source: a.source });
function observationHash(o: MetaAccountingObservation) {
  const u = o.usage;
  return hash({ version: "rpf-meta-usage-v1", effectId: o.effectId, outcome: o.outcome, usage: u === null ? null : {
    prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: u.total_tokens,
    ...(u.prompt_tokens_details ? { prompt_tokens_details: { cached_tokens: u.prompt_tokens_details.cached_tokens } } : {}),
    ...(u.completion_tokens_details ? { completion_tokens_details: { reasoning_tokens: u.completion_tokens_details.reasoning_tokens } } : {}) } });
}
const attemptColumns = '"effectId","jobId","jobVersion","requestHash","model","maxOutputTokens","source","intentSha256"';
const observationColumns = '"effectId","outcome","usagePresent","promptTokens"::double precision AS "promptTokens",'+
  '"completionTokens"::double precision AS "completionTokens","totalTokens"::double precision AS "totalTokens",'+
  '"cachedTokens"::double precision AS "cachedTokens","reasoningTokens"::double precision AS "reasoningTokens","observationSha256"';
const storedAttempt = metaAccountingAttemptSchema.extend({ intentSha256: digest });
const storedObservation = z.object({ effectId: uuid, outcome: metaAccountingObservationSchema.shape.outcome,
  usagePresent: z.boolean(), promptTokens: count.nullable(), completionTokens: count.nullable(), totalTokens: count.nullable(),
  cachedTokens: count.nullable(), reasoningTokens: count.nullable(), observationSha256: digest }).strict();
type Query = (sql: string, values?: unknown[]) => Promise<QueryResult>;
async function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  void pending.catch(() => {}); signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Meta accounting deadline")); signal.addEventListener("abort", abort, { once: true });
  })]); } finally { if (abort) signal.removeEventListener("abort", abort); }
}

/** Append-only accounting preparation. Deliberately NOT a MetaAccess grant. */
export class PostgresMetaAccounting {
  #pool: Pick<Pool, "connect">;
  constructor(pool: Pick<Pool, "connect">, private readonly timeoutMs = 7000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 7000) throw new Error("Invalid Meta accounting deadline");
    this.#pool = pool;
  }
  toJSON() { return { store: "postgres-meta-accounting" }; }
  async #transaction<T>(work: (query: Query) => Promise<T>): Promise<JobResult<T>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let client: PoolClient | undefined, released = false;
    const release = (destroy: boolean) => { if (client && !released) { released = true; try { client.release(destroy); } catch { /* Safe disposal. */ } } };
    const abort = () => release(true); controller.signal.addEventListener("abort", abort, { once: true });
    try {
      const pending = this.#pool.connect();
      void pending.then(late => { if (controller.signal.aborted) { try { late.release(true); } catch { /* Discard late connection. */ } } }, () => {});
      client = await bounded(pending, controller.signal);
      const query: Query = (sql, values) => { controller.signal.throwIfAborted(); return bounded(client!.query(sql, values), controller.signal); };
      await query("BEGIN"); await query("SET LOCAL statement_timeout='2s'"); await query("SET LOCAL lock_timeout='2s'");
      const result = await work(query); await query("COMMIT"); return { ok: true, value: result };
    } catch {
      // A real COMMIT may be hidden by acknowledgement loss. Never retry here.
      release(true); return { ok: false, reason: "UNAVAILABLE" };
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); release(false); }
  }
  async #read(query: Query, effectId: string): Promise<MetaAccountingRecord | null> {
    const a = await query(`SELECT ${attemptColumns} FROM public."MetaAttemptAccounting" WHERE "effectId"=$1`, [effectId]);
    if (!a.rowCount) return null;
    const { intentSha256, ...attempt } = storedAttempt.parse(a.rows[0]);
    if (attempt.effectId !== effectId || attemptHash(attempt) !== intentSha256) throw new Error("Meta intent integrity");
    const o = await query(`SELECT ${observationColumns} FROM public."MetaUsageObservation" WHERE "effectId"=$1`, [effectId]);
    let observation: MetaAccountingObservation | null = null;
    if (o.rowCount) {
      const row = storedObservation.parse(o.rows[0]);
      if (!row.usagePresent && [row.promptTokens, row.completionTokens, row.totalTokens, row.cachedTokens, row.reasoningTokens].some(v => v !== null)) throw new Error("Unknown usage is not zero");
      observation = metaAccountingObservationSchema.parse({ effectId: row.effectId, outcome: row.outcome, usage: !row.usagePresent ? null : {
        prompt_tokens: row.promptTokens, completion_tokens: row.completionTokens, total_tokens: row.totalTokens,
        ...(row.cachedTokens !== null ? { prompt_tokens_details: { cached_tokens: row.cachedTokens } } : {}),
        ...(row.reasoningTokens !== null ? { completion_tokens_details: { reasoning_tokens: row.reasoningTokens } } : {}) } });
      if (row.effectId !== effectId || observationHash(observation) !== row.observationSha256) throw new Error("Meta usage integrity");
    }
    return Object.freeze({ attempt, observation, dispatchAllowed: false, noChargeEntitlementVerified: false,
      independentReviewRequired: true, outputLimitExceeded: observation?.usage !== null && observation?.usage !== undefined && observation.usage.completion_tokens > attempt.maxOutputTokens });
  }
  async prepare(input: MetaAccountingAttempt): Promise<JobResult<MetaAccountingRecord | null>> {
    const parsed = metaAccountingAttemptSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "INVALID" };
    const a = parsed.data, intentSha256 = attemptHash(a);
    return this.#transaction(async query => {
      // Recovery with the original effect identity works even after cancellation
      // or expiry. It acknowledges accounting only, never permission to dispatch.
      let current = await this.#read(query, a.effectId);
      if (!current) {
        await query(`INSERT INTO public."MetaAttemptAccounting" ("effectId","jobId","jobVersion","requestHash","model","maxOutputTokens","source","intentSha256")
          SELECT $1::uuid,$2::uuid,$3::integer,$4::char(64),$5::varchar(128),$6::integer,$7::varchar(24),$8::char(64)
          FROM public."ExecutionJob" j JOIN public."ExecutionEffect" e ON e."jobId"=j."id"
          WHERE e."id"=$1 AND j."id"=$2 AND j."version"=$3 AND e."kind"='META' AND e."requestHash"=$4
            AND j."state"='QUARANTINED' AND NOT j."cancelRequested" AND j."deadlineAt">clock_timestamp()
          ON CONFLICT DO NOTHING`, [a.effectId,a.jobId,a.jobVersion,a.requestHash,a.model,a.maxOutputTokens,a.source,intentSha256]);
        current = await this.#read(query, a.effectId);
      }
      return current && attemptHash(current.attempt) === intentSha256 ? current : null;
    });
  }
  async record(input: MetaAccountingObservation): Promise<JobResult<MetaAccountingRecord | null>> {
    const parsed = metaAccountingObservationSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "INVALID" };
    const o = parsed.data, observationSha256 = observationHash(o), u = o.usage;
    return this.#transaction(async query => {
      let current = await this.#read(query, o.effectId);
      if (!current) return null;
      if (!current.observation) {
        // Late outcomes may account for an already submitted effect after its
        // job expires/cancels. They cannot release quarantine or erase unknowns.
        await query(`INSERT INTO public."MetaUsageObservation" ("effectId","outcome","usagePresent","promptTokens","completionTokens","totalTokens","cachedTokens","reasoningTokens","observationSha256")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, [o.effectId,o.outcome,u !== null,u?.prompt_tokens ?? null,
          u?.completion_tokens ?? null,u?.total_tokens ?? null,u?.prompt_tokens_details?.cached_tokens ?? null,u?.completion_tokens_details?.reasoning_tokens ?? null,observationSha256]);
        current = await this.#read(query, o.effectId);
      }
      return current?.observation && observationHash(current.observation) === observationSha256 ? current : null;
    });
  }
  async load(effectId: string): Promise<JobResult<MetaAccountingRecord | null>> {
    if (!uuid.safeParse(effectId).success) return { ok: false, reason: "INVALID" };
    return this.#transaction(query => this.#read(query, effectId));
  }
}
