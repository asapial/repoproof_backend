import { randomBytes, createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import { z } from "zod";

const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const owner = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const submission = z.object({ id: uuid, ownerId: owner, idempotencyKey: uuid,
  requestHash: digest, deadlineAtMs: z.number().int().positive().safe() }).strict();
const ownedJob = z.object({ ownerId: owner, id: uuid }).strict();
const effect = z.object({ id: uuid, kind: z.enum(["META","SANDBOX"]), requestHash: digest }).strict();
export type JobSubmission = z.infer<typeof submission>;
export type JobStatus = Readonly<{ id: string; state: "QUEUED" | "LEASED" | "QUARANTINED" | "CANCELLED" | "EXPIRED";
  version: number; attempts: number; cancelRequested: boolean; deadlineAtMs: number }>;
export type JobResult<T> = { ok: true; value: T } | { ok: false; reason: "INVALID" | "UNAVAILABLE" };
type Query = (text: string, values?: unknown[]) => Promise<QueryResult>;
type Credential = { id: string; version: number; hash: string };
const credentials = new WeakMap<ExecutionLease, Credential>();

// The bearer proof never leaves this module or serializes. An invocation losing
// its handle must use durable recovery; it cannot reconstruct a lease from JSON.
export class ExecutionLease {
  constructor(readonly job: JobStatus) { Object.freeze(job); Object.freeze(this); }
  toJSON() { return { lease: "private", job: this.job }; }
}

const columns = '"id","state","version","attempts","cancelRequested",(extract(epoch FROM "deadlineAt")*1000)::double precision AS "deadlineAtMs"';
const activeLease = '"id"=$1 AND "version"=$2 AND "leaseHash"=$3 AND "state"=\'LEASED\' AND NOT "cancelRequested" AND "leaseExpiresAt">clock_timestamp() AND "deadlineAt">clock_timestamp()';

async function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  void pending.catch(() => {}); signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try { return await Promise.race([pending,new Promise<never>((_resolve,reject) => {
    abort = () => reject(new Error("Job store deadline")); signal.addEventListener("abort",abort,{ once: true });
  })]); } finally { if (abort) signal.removeEventListener("abort",abort); }
}

export class PostgresExecutionJobs {
  #pool: Pick<Pool,"connect">;
  constructor(pool: Pick<Pool,"connect">, private readonly timeoutMs = 7000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>7000) throw new Error("Invalid job store deadline");
    this.#pool = pool;
  }
  toJSON() { return { store: "postgres-execution-jobs" }; }
  async #transaction<T>(work: (query: Query) => Promise<T>): Promise<JobResult<T>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),this.timeoutMs);
    let client: PoolClient | undefined, released = false;
    const release = (destroy: boolean) => { if (client && !released) { released=true; try { client.release(destroy); } catch { /* No raw driver errors. */ } } };
    const abort = () => release(true); controller.signal.addEventListener("abort",abort,{ once: true });
    try {
      const connection = this.#pool.connect();
      void connection.then(late => { if (controller.signal.aborted) { try { late.release(true); } catch { /* Discard late connection. */ } } },() => {});
      client = await bounded(connection,controller.signal);
      const query: Query = (text,values) => { controller.signal.throwIfAborted(); return bounded(client!.query(text,values),controller.signal); };
      await query("BEGIN"); await query("SET LOCAL statement_timeout='2s'"); await query("SET LOCAL lock_timeout='2s'");
      const value = await work(query); await query("COMMIT"); return { ok: true, value };
    } catch {
      // COMMIT may have succeeded. Never repeat this transaction or manufacture
      // another idempotency key/effect ID after an unavailable acknowledgement.
      release(true); return { ok: false, reason: "UNAVAILABLE" };
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort",abort); release(false); }
  }
  async submit(input: JobSubmission): Promise<JobResult<JobStatus | null>> {
    const parsed = submission.safeParse(input); if (!parsed.success) return { ok: false, reason: "INVALID" };
    const value = parsed.data;
    return this.#transaction(async query => {
      await query(`INSERT INTO "ExecutionJob" ("id","ownerId","idempotencyKey","requestHash","createdAt","deadlineAt")
        SELECT $1,$2,$3,$4,clock_timestamp(),to_timestamp($5::double precision/1000)
        WHERE to_timestamp($5::double precision/1000)>clock_timestamp()
          AND to_timestamp($5::double precision/1000)<=clock_timestamp()+interval '5 minutes'
        ON CONFLICT DO NOTHING`,[value.id,value.ownerId,value.idempotencyKey,value.requestHash,value.deadlineAtMs]);
      const row = await query(`SELECT ${columns} FROM "ExecutionJob" WHERE "ownerId"=$1 AND "idempotencyKey"=$2 AND "requestHash"=$3`,[value.ownerId,value.idempotencyKey,value.requestHash]);
      return (row.rows[0] as JobStatus | undefined) ?? null;
    });
  }
  async get(input: { ownerId: string; id: string }): Promise<JobResult<JobStatus | null>> {
    const parsed = ownedJob.safeParse(input); if (!parsed.success) return { ok: false, reason: "INVALID" };
    return this.#transaction(async query => {
      const row = await query(`SELECT ${columns} FROM "ExecutionJob" WHERE "id"=$1 AND "ownerId"=$2`,[parsed.data.id,parsed.data.ownerId]);
      return (row.rows[0] as JobStatus | undefined) ?? null;
    });
  }
  async claim(): Promise<JobResult<ExecutionLease | null>> {
    return this.#transaction(async query => {
      const lock = await query("SELECT pg_try_advisory_xact_lock(1380992586,1) AS acquired");
      if (!lock.rows[0].acquired) return null;
      const busy = await query('SELECT 1 FROM "ExecutionJob" WHERE "state" IN (\'LEASED\',\'QUARANTINED\') LIMIT 1');
      if (busy.rowCount) return null;
      const next = await query(`SELECT "id" FROM "ExecutionJob" WHERE "state"='QUEUED' AND NOT "cancelRequested"
        AND "attempts"<3 AND "deadlineAt">clock_timestamp() ORDER BY "createdAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!next.rowCount) return null;
      const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
      const row = await query(`UPDATE "ExecutionJob" SET "state"='LEASED',"version"="version"+1,"attempts"="attempts"+1,
        "leaseHash"=$2,"leaseExpiresAt"=least("deadlineAt",clock_timestamp()+interval '5 seconds') WHERE "id"=$1 RETURNING ${columns}`,[next.rows[0].id,hash]);
      const job = row.rows[0] as JobStatus, lease = new ExecutionLease(job);
      credentials.set(lease,{ id: job.id, version: job.version, hash }); return lease;
    });
  }
  async release(lease: ExecutionLease): Promise<JobResult<boolean>> {
    const proof = credentials.get(lease); if (!proof) return { ok: false, reason: "INVALID" };
    return this.#transaction(async query => {
      const row = await query(`UPDATE "ExecutionJob" SET "state"=CASE WHEN "attempts">=3 THEN 'EXPIRED' ELSE 'QUEUED' END,
        "leaseHash"=NULL,"leaseExpiresAt"=NULL,"version"="version"+1 WHERE ${activeLease}
        AND NOT EXISTS(SELECT 1 FROM "ExecutionEffect" WHERE "jobId"="ExecutionJob"."id")`,[proof.id,proof.version,proof.hash]);
      return row.rowCount===1;
    });
  }
  async cancel(input: { ownerId: string; id: string }): Promise<JobResult<JobStatus | null>> {
    const parsed = ownedJob.safeParse(input); if (!parsed.success) return { ok: false, reason: "INVALID" };
    return this.#transaction(async query => {
      const existing = await query(`SELECT ${columns} FROM "ExecutionJob" WHERE "id"=$1 AND "ownerId"=$2 FOR UPDATE`,[parsed.data.id,parsed.data.ownerId]);
      const job = existing.rows[0] as JobStatus | undefined;
      if (!job || job.cancelRequested || job.state==='CANCELLED' || job.state==='EXPIRED') return job ?? null;
      const row = await query(`UPDATE "ExecutionJob" SET "cancelRequested"=true,"version"="version"+1,
        "state"=CASE WHEN "state"='QUARANTINED' THEN 'QUARANTINED' ELSE 'CANCELLED' END,
        "leaseHash"=NULL,"leaseExpiresAt"=NULL WHERE "id"=$1 RETURNING ${columns}`,[job.id]);
      return row.rows[0] as JobStatus;
    });
  }
  async recover(): Promise<JobResult<number>> {
    return this.#transaction(async query => {
      const row = await query(`WITH stale AS (SELECT "id" FROM "ExecutionJob" WHERE
        ("state"='LEASED' AND ("leaseExpiresAt"<=clock_timestamp() OR "deadlineAt"<=clock_timestamp()))
        OR ("state"='QUEUED' AND "deadlineAt"<=clock_timestamp()) ORDER BY "createdAt","id" LIMIT 100 FOR UPDATE SKIP LOCKED)
        UPDATE "ExecutionJob" j SET "version"=j."version"+1,"leaseHash"=NULL,"leaseExpiresAt"=NULL,
        "state"=CASE WHEN EXISTS(SELECT 1 FROM "ExecutionEffect" e WHERE e."jobId"=j."id") THEN 'QUARANTINED'
          WHEN j."cancelRequested" THEN 'CANCELLED' WHEN j."deadlineAt"<=clock_timestamp() OR j."attempts">=3 THEN 'EXPIRED'
          ELSE 'QUEUED' END FROM stale WHERE j."id"=stale."id" RETURNING j."id"`);
      return row.rowCount ?? 0;
    });
  }
  async recordPossibleEffect(lease: ExecutionLease, input: z.infer<typeof effect>): Promise<JobResult<boolean>> {
    const proof = credentials.get(lease), parsed = effect.safeParse(input);
    if (!proof || !parsed.success) return { ok: false, reason: "INVALID" };
    return this.#transaction(async query => {
      const row = await query(`SELECT "id" FROM "ExecutionJob" WHERE ${activeLease} FOR UPDATE`,[proof.id,proof.version,proof.hash]);
      if (!row.rowCount) return false;
      const inserted = await query(`INSERT INTO "ExecutionEffect" ("id","jobId","kind","requestHash") VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING RETURNING "id"`,[parsed.data.id,proof.id,parsed.data.kind,parsed.data.requestHash]);
      // The SQL trigger atomically invalidates this lease and quarantines the job.
      // This records uncertainty only; it never returns a dispatch permission.
      return inserted.rowCount===1;
    });
  }
}
