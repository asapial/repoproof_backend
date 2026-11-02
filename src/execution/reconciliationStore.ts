import { z } from "zod";
import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import { encodeReconciliation, reconciliationContextSchema, reconciliationRecord, type AcceptedReconciliation, type ReconciliationContext, type ReconciliationObservation } from "./reconciliation";
import type { JobResult } from "./jobs";

const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
type Query = (text: string, values?: unknown[]) => Promise<QueryResult>;
const contextColumns = 'j."id" AS "jobId",e."id" AS "effectId",j."version" AS "jobVersion",e."kind",e."requestHash",j."state",j."cancelRequested",(extract(epoch FROM j."deadlineAt")*1000)::double precision AS "deadlineAtMs"';
async function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  void pending.catch(() => {}); signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Reconciliation deadline")); signal.addEventListener("abort", abort, { once: true });
  })]); } finally { if (abort) signal.removeEventListener("abort", abort); }
}
export class PostgresReconciliations {
  #pool: Pick<Pool, "connect">;
  constructor(pool: Pick<Pool, "connect">, private readonly timeoutMs = 7000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 7000) throw new Error("Invalid reconciliation deadline");
    this.#pool = pool;
  }
  toJSON() { return { store: "postgres-reconciliation" }; }
  async #transaction<T>(work: (query: Query) => Promise<T>): Promise<JobResult<T>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let client: PoolClient | undefined, released = false;
    const release = (destroy: boolean) => { if (client && !released) { released = true; try { client.release(destroy); } catch { /* Safe disposal. */ } } };
    const abort = () => release(true); controller.signal.addEventListener("abort", abort, { once: true });
    try {
      const pending = this.#pool.connect();
      void pending.then(late => { if (controller.signal.aborted) { try { late.release(true); } catch { /* Discard late connection. */ } } }, () => {});
      client = await bounded(pending, controller.signal);
      const query: Query = (text, values) => { controller.signal.throwIfAborted(); return bounded(client!.query(text, values), controller.signal); };
      await query("BEGIN"); await query("SET LOCAL statement_timeout='2s'"); await query("SET LOCAL lock_timeout='2s'");
      const result = await work(query); await query("COMMIT"); return { ok: true, value: result };
    } catch {
      // Acknowledgement loss may hide a commit. No provider resend or new key.
      release(true); return { ok: false, reason: "UNAVAILABLE" };
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); release(false); }
  }
  async context(jobId: string, effectId: string): Promise<JobResult<ReconciliationContext | null>> {
    if (!uuid.safeParse(jobId).success || !uuid.safeParse(effectId).success) return { ok: false, reason: "INVALID" };
    return this.#transaction(async query => {
      const row = await query(`SELECT ${contextColumns} FROM public."ExecutionJob" j JOIN public."ExecutionEffect" e ON e."jobId"=j."id"
        WHERE j."id"=$1 AND e."id"=$2 AND j."state"='QUARANTINED'`, [jobId, effectId]);
      return row.rowCount ? reconciliationContextSchema.parse(row.rows[0]) : null;
    });
  }
  async append(handle: AcceptedReconciliation): Promise<JobResult<boolean>> {
    let observation;
    try { observation = reconciliationRecord(handle); } catch { return { ok: false, reason: "INVALID" }; }
    const o = observation, c = o.context;
    return this.#transaction(async query => {
      const existing = await query('SELECT "payloadSha256" FROM public."ExecutionReconciliation" WHERE "evidenceId"=$1', [o.evidenceId]);
      if (existing.rowCount) return existing.rows[0].payloadSha256 === handle.payloadSha256;
      await query(`INSERT INTO public."ExecutionReconciliation" ("evidenceId","jobId","effectId","jobVersion","kind","requestHash","observerFingerprint","keyId","source",
        "observedState","providerIdentitySha256","cleanupConfirmed","noChargeConfirmed","factsSha256","observedAtMs","expiresAtMs","payloadSha256","signature","cancelRequested","deadlineAtMs")
        SELECT $1::uuid,$2::uuid,$3::uuid,$4::integer,$5::varchar(16),$6::char(64),$7::char(64),$8::varchar(128),$9::varchar(24),
          $10::varchar(16),$11::char(64),$12::boolean,$13::boolean,$14::char(64),$15::bigint,$16::bigint,$17::char(64),$18::char(128),$19::boolean,$20::bigint
        FROM public."ExecutionJob" j JOIN public."ExecutionEffect" e ON e."jobId"=j."id"
        WHERE j."id"=$2 AND e."id"=$3 AND j."version"=$4 AND j."state"='QUARANTINED' AND e."kind"=$5 AND e."requestHash"=$6
          AND j."cancelRequested"=$19 AND (extract(epoch FROM j."deadlineAt")*1000)::bigint=$20
        ON CONFLICT DO NOTHING`, [o.evidenceId,c.jobId,c.effectId,c.jobVersion,c.kind,c.requestHash,handle.observerFingerprint,o.keyId,o.source,
        o.observedState,o.providerIdentitySha256,o.cleanupConfirmed,o.noChargeConfirmed,o.factsSha256,o.observedAtMs,o.expiresAtMs,handle.payloadSha256,o.signature,c.cancelRequested,c.deadlineAtMs]);
      const row = await query('SELECT "payloadSha256" FROM public."ExecutionReconciliation" WHERE "evidenceId"=$1', [o.evidenceId]);
      return row.rowCount === 1 && row.rows[0].payloadSha256 === handle.payloadSha256;
    });
  }
  async load(evidenceId: string): Promise<JobResult<{ bytes: Buffer; payloadSha256: string; observerFingerprint: string; authentic: false } | null>> {
    if (!uuid.safeParse(evidenceId).success) return { ok: false, reason: "INVALID" };
    return this.#transaction(async query => {
      const result = await query(`SELECT "evidenceId","jobId","effectId","jobVersion","kind","requestHash","cancelRequested",
        "deadlineAtMs"::double precision AS "deadlineAtMs","observerFingerprint","keyId","source","observedState",
        "providerIdentitySha256","cleanupConfirmed","noChargeConfirmed","factsSha256","observedAtMs"::double precision AS "observedAtMs",
        "expiresAtMs"::double precision AS "expiresAtMs","payloadSha256","signature" FROM public."ExecutionReconciliation" WHERE "evidenceId"=$1`, [evidenceId]);
      if (!result.rowCount) return null;
      const row = result.rows[0];
      const observation: ReconciliationObservation = { version: "rpf-reconciliation-v1", evidenceId: row.evidenceId,
        context: { jobId: row.jobId, effectId: row.effectId, jobVersion: row.jobVersion, kind: row.kind, requestHash: row.requestHash,
          state: "QUARANTINED", cancelRequested: row.cancelRequested, deadlineAtMs: row.deadlineAtMs },
        source: row.source, keyId: row.keyId, observedAtMs: row.observedAtMs, expiresAtMs: row.expiresAtMs, observedState: row.observedState,
        providerIdentitySha256: row.providerIdentitySha256, cleanupConfirmed: row.cleanupConfirmed, noChargeConfirmed: row.noChargeConfirmed,
        factsSha256: row.factsSha256, signature: row.signature };
      const bytes = encodeReconciliation(observation);
      if (createHash("sha256").update(bytes).digest("hex") !== row.payloadSha256) throw new Error("Stored reconciliation integrity");
      // Restart/retrieval does not restore signature or fact authority. Reassess
      // with current independent trust keys and current durable context.
      return { bytes, payloadSha256: row.payloadSha256, observerFingerprint: row.observerFingerprint, authentic: false as const };
    });
  }
}
