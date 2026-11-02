import { createHash } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient, QueryResult } from "pg";
import type { JobResult } from "./jobs";

const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/), digest = z.string().regex(/^[a-f0-9]{64}$/), zero = "0".repeat(64);
const time = z.number().int().nonnegative().safe(), seq = z.number().int().min(0).max(15);
const kind = z.enum(["OPEN","INTAKE","FREEZE","BASELINE_ISSUE","BASELINE_REGRESSIONS","PATCH_PREPARED","PATCHED_ISSUE","PATCHED_REGRESSIONS","CANCEL","EXPIRE"]);
const outcome = z.enum(["NONE","ALLOWED","DENIED","PASS","ASSERTION_FAILURE","INCONCLUSIVE","UNCERTAIN"]);
const state = z.enum(["OPEN","INTAKE_ACCEPTED","FROZEN","BASELINE_FAILED","BASELINE_CLEAR","PATCH_READY","PATCHED_PASS",
  "AWAITING_TRUST_REVIEW","NO_REPRO_PREPARATION","REJECTED_PREPARATION","INCONCLUSIVE","QUARANTINED","CANCELLED","EXPIRED"]);
const terminal = new Set(["AWAITING_TRUST_REVIEW","NO_REPRO_PREPARATION","REJECTED_PREPARATION","INCONCLUSIVE","QUARANTINED","CANCELLED","EXPIRED"]);
const opening = z.object({ flowId: uuid, requestHash: digest, deadlineAtMs: time }).strict();
export const stageCommandSchema = z.object({ flowId: uuid, expectedSequence: seq, expectedRecordSha256: digest,
  kind: kind.exclude(["OPEN"]), outcome, referenceSha256: digest, frozenPackageId: uuid.nullable(), frozenManifestSha256: digest.nullable() }).strict();
export type StageCommand = z.infer<typeof stageCommandSchema>;
const recordSchema = z.object({ version: z.literal("rpf-stage-journal-v1"), mode: z.literal("OFFLINE_PREPARATION"),
  flowId: uuid, sequence: seq, previousSha256: digest, requestHash: digest, deadlineAtMs: time, kind, outcome,
  referenceSha256: digest, frozenPackageId: uuid.nullable(), frozenManifestSha256: digest.nullable(), state, cancelRequested: z.boolean() }).strict();
export type StageRecord = z.infer<typeof recordSchema>;
export type StageView = Readonly<{ record: StageRecord; recordSha256: string; dispatchAllowed: false; productionVerdict: "INCONCLUSIVE" }>;
const encode = (r: StageRecord) => Buffer.from(JSON.stringify(recordSchema.parse(r)));
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const invalid = () => { throw new Error("Invalid stage transition"); };

/** Preparation ordering only. Artifact references are not authenticated evidence. */
export function nextStage(previous: StageRecord, command: StageCommand, nowMs: number): StageRecord {
  const p = recordSchema.parse(previous), c = stageCommandSchema.parse(command); time.parse(nowMs);
  if (p.flowId !== c.flowId || p.sequence !== c.expectedSequence || hash(encode(p)) !== c.expectedRecordSha256 || p.sequence >= 15) invalid();
  let next: StageRecord["state"];
  if (c.kind === "CANCEL") {
    if (c.outcome !== "NONE" || p.cancelRequested || (terminal.has(p.state) && p.state !== "QUARANTINED")) invalid();
    next = p.state === "QUARANTINED" ? "QUARANTINED" : "CANCELLED";
  } else if (c.kind === "EXPIRE") {
    if (c.outcome !== "NONE" || terminal.has(p.state) || nowMs < p.deadlineAtMs) invalid(); next = "EXPIRED";
  } else {
    if (terminal.has(p.state) || p.cancelRequested || nowMs >= p.deadlineAtMs) invalid();
    const required: Partial<Record<StageCommand["kind"], StageRecord["state"]>> = { INTAKE: "OPEN",FREEZE: "INTAKE_ACCEPTED",
      BASELINE_ISSUE: "FROZEN",BASELINE_REGRESSIONS: "BASELINE_FAILED",PATCH_PREPARED: "BASELINE_CLEAR",PATCHED_ISSUE: "PATCH_READY",PATCHED_REGRESSIONS: "PATCHED_PASS" };
    if (required[c.kind] !== p.state) invalid();
    if (c.outcome === "UNCERTAIN") next = "QUARANTINED";
    else if (c.outcome === "INCONCLUSIVE") next = "INCONCLUSIVE";
    else if (["INTAKE","FREEZE","PATCH_PREPARED"].includes(c.kind)) {
      if (c.outcome !== "ALLOWED" && c.outcome !== "DENIED") invalid();
      next = c.outcome === "DENIED" ? "REJECTED_PREPARATION" : c.kind === "INTAKE" ? "INTAKE_ACCEPTED" : c.kind === "FREEZE" ? "FROZEN" : "PATCH_READY";
    } else {
      if (c.outcome !== "PASS" && c.outcome !== "ASSERTION_FAILURE") invalid();
      next = c.kind === "BASELINE_ISSUE" ? c.outcome === "PASS" ? "NO_REPRO_PREPARATION" : "BASELINE_FAILED" :
        c.outcome !== "PASS" ? "INCONCLUSIVE" : c.kind === "BASELINE_REGRESSIONS" ? "BASELINE_CLEAR" : c.kind === "PATCHED_ISSUE" ? "PATCHED_PASS" : "AWAITING_TRUST_REVIEW";
    }
  }
  if (c.kind === "FREEZE" && c.outcome === "ALLOWED") {
    if (!c.frozenPackageId || !c.frozenManifestSha256 || c.referenceSha256 !== c.frozenManifestSha256) invalid();
  } else if (c.frozenPackageId !== p.frozenPackageId || c.frozenManifestSha256 !== p.frozenManifestSha256) invalid();
  return recordSchema.parse({ ...p,sequence: p.sequence+1,previousSha256: c.expectedRecordSha256,kind: c.kind,outcome: c.outcome,
    referenceSha256: c.referenceSha256,frozenPackageId: c.frozenPackageId,frozenManifestSha256: c.frozenManifestSha256,state: next!,cancelRequested: p.cancelRequested || c.kind === "CANCEL" });
}
const view = (record: StageRecord): StageView => Object.freeze({ record: Object.freeze(record),recordSha256: hash(encode(record)),dispatchAllowed: false,productionVerdict: "INCONCLUSIVE" });
type Query = (sql: string, values?: unknown[]) => Promise<QueryResult>;
async function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  void pending.catch(() => {}); signal.throwIfAborted(); let abort: (() => void) | undefined;
  try { return await Promise.race([pending,new Promise<never>((_resolve,reject) => { abort = () => reject(new Error("Stage deadline")); signal.addEventListener("abort",abort,{ once: true }); })]); }
  finally { if (abort) signal.removeEventListener("abort",abort); }
}
export class PostgresStageJournal {
  #pool: Pick<Pool,"connect">;
  constructor(pool: Pick<Pool,"connect">, private readonly timeoutMs = 7000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 7000) throw new Error("Invalid stage deadline"); this.#pool = pool;
  }
  toJSON() { return { store: "postgres-stage-journal" }; }
  async #transaction<T>(work: (query: Query) => Promise<T>): Promise<JobResult<T>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),this.timeoutMs);
    let client: PoolClient | undefined, released = false;
    const release = (destroy: boolean) => { if (client && !released) { released = true; try { client.release(destroy); } catch { /* Safe disposal. */ } } };
    const abort = () => release(true); controller.signal.addEventListener("abort",abort,{ once: true });
    try {
      const pending = this.#pool.connect(); void pending.then(late => { if (controller.signal.aborted) { try { late.release(true); } catch { /* Discard late connection. */ } } },() => {});
      client = await bounded(pending,controller.signal);
      const query: Query = (sql,values) => { controller.signal.throwIfAborted(); return bounded(client!.query(sql,values),controller.signal); };
      await query("BEGIN"); await query("SET LOCAL statement_timeout='2s'"); await query("SET LOCAL lock_timeout='2s'");
      const result = await work(query); await query("COMMIT"); return { ok: true,value: result };
    } catch { release(true); return { ok: false,reason: "UNAVAILABLE" }; }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort",abort); release(false); }
  }
  async #read(query: Query, flowId: string): Promise<StageView[]> {
    const rows = await query('SELECT "payload","recordSha256","recordedAtMs"::double precision AS "recordedAtMs" FROM public."ExecutionStageJournal" WHERE "flowId"=$1 ORDER BY "sequence" LIMIT 17',[flowId]);
    if (rows.rows.length > 16) invalid(); const records: StageView[] = [];
    for (const row of rows.rows) {
      if (!(row.payload instanceof Uint8Array) || row.payload.byteLength > 4096) invalid();
      const bytes = Buffer.from(row.payload), record = recordSchema.parse(JSON.parse(new TextDecoder("utf-8",{ fatal: true,ignoreBOM: true }).decode(bytes)));
      time.parse(row.recordedAtMs);
      if (record.flowId !== flowId || record.sequence !== records.length || !bytes.equals(encode(record)) || hash(bytes) !== row.recordSha256) invalid();
      const previous = records.at(-1);
      if (!previous) {
        if (record.kind !== "OPEN" || record.state !== "OPEN" || record.outcome !== "NONE" || record.previousSha256 !== zero || record.cancelRequested ||
          record.frozenPackageId !== null || record.frozenManifestSha256 !== null || record.referenceSha256 !== record.requestHash ||
          record.deadlineAtMs <= row.recordedAtMs || record.deadlineAtMs > row.recordedAtMs+3600000) invalid();
      } else {
        const reproduced = nextStage(previous.record,{ flowId,expectedSequence: previous.record.sequence,expectedRecordSha256: previous.recordSha256,
          kind: record.kind as StageCommand["kind"],outcome: record.outcome,referenceSha256: record.referenceSha256,
          frozenPackageId: record.frozenPackageId,frozenManifestSha256: record.frozenManifestSha256 },row.recordedAtMs);
        if (!encode(reproduced).equals(bytes)) invalid();
      }
      if (record.frozenPackageId) {
        const sealed = await query('SELECT "manifestSha256" FROM public."FrozenPreparationPackage" WHERE "id"=$1',[record.frozenPackageId]);
        if (sealed.rowCount !== 1 || sealed.rows[0].manifestSha256 !== record.frozenManifestSha256) invalid();
      }
      records.push(view(record));
    }
    return records;
  }
  async #insert(query: Query, record: StageRecord) {
    const payload = encode(record);
    await query(`INSERT INTO public."ExecutionStageJournal" ("flowId","sequence","previousSha256","requestHash","deadlineAtMs","kind","outcome","referenceSha256","frozenPackageId","frozenManifestSha256","state","cancelRequested","payload","recordSha256")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,[record.flowId,record.sequence,record.previousSha256,record.requestHash,record.deadlineAtMs,
      record.kind,record.outcome,record.referenceSha256,record.frozenPackageId,record.frozenManifestSha256,record.state,record.cancelRequested,payload,hash(payload)]);
  }
  async open(input: z.infer<typeof opening>): Promise<JobResult<StageView | null>> {
    const parsed = opening.safeParse(input); if (!parsed.success) return { ok: false,reason: "INVALID" };
    const first: StageRecord = { version: "rpf-stage-journal-v1",mode: "OFFLINE_PREPARATION",...parsed.data,sequence: 0,previousSha256: zero,kind: "OPEN",outcome: "NONE",
      referenceSha256: parsed.data.requestHash,frozenPackageId: null,frozenManifestSha256: null,state: "OPEN",cancelRequested: false };
    return this.#transaction(async query => {
      let rows = await this.#read(query,first.flowId);
      if (!rows.length) { await this.#insert(query,first); rows = await this.#read(query,first.flowId); }
      return rows[0]?.recordSha256 === hash(encode(first)) ? rows.at(-1)! : null;
    });
  }
  async append(input: StageCommand): Promise<JobResult<StageView | null>> {
    const parsed = stageCommandSchema.safeParse(input); if (!parsed.success) return { ok: false,reason: "INVALID" }; const c = parsed.data;
    return this.#transaction(async query => {
      let rows = await this.#read(query,c.flowId); const expected = rows[c.expectedSequence];
      if (!expected || expected.recordSha256 !== c.expectedRecordSha256) return null;
      const now = await query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS "nowMs"');
      const existing = rows[c.expectedSequence+1];
      // Replay existing immutable transitions at their accepted time via #read;
      // an idempotent acknowledgement must remain available after expiry.
      const next = existing ? { ...existing.record,kind: c.kind,outcome: c.outcome,referenceSha256: c.referenceSha256,
        frozenPackageId: c.frozenPackageId,frozenManifestSha256: c.frozenManifestSha256 } : nextStage(expected.record,c,now.rows[0].nowMs);
      if (!existing) { await this.#insert(query,next); rows = await this.#read(query,c.flowId); }
      return rows[c.expectedSequence+1]?.recordSha256 === hash(encode(next)) ? rows.at(-1)! : null;
    });
  }
  async load(flowId: string): Promise<JobResult<StageView | null>> {
    if (!uuid.safeParse(flowId).success) return { ok: false,reason: "INVALID" };
    return this.#transaction(async query => (await this.#read(query,flowId)).at(-1) ?? null);
  }
}
