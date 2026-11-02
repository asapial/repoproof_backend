import { z } from "zod";
import type { Pool, PoolClient, QueryResult } from "pg";
import { generatedPatchSchema, modelSourceSchema, type MetaTaskProvider, type ModelSource } from "../meta/tasks";
import { encodeFrozenPackage, restoreFrozenPackage } from "../verification/frozenPackage";
import { prepareBaseline, prepareDiscountPatch, readSnapshot, sha256, type FrozenTest, type PreparedSnapshot } from "../verification/frozen";
import type { JobResult } from "./jobs";

const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
const storedSchema = z.object({ id: uuid, manifestSha256: digest, payloadSha256: digest,
  payload: z.custom<Uint8Array<ArrayBufferLike>>(value => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 65536),
  createdAtMs: z.number().int().nonnegative().safe() }).strict();
export type DurableFreeze = Readonly<{ id: string; manifestSha256: string; payloadSha256: string; createdAtMs: number; purpose: "PREPARATION_ONLY" }>;
const durable = new WeakMap<DurableFreeze, FrozenTest>();
const columns = '"id","manifestSha256","payloadSha256","payload",(extract(epoch FROM "createdAt")*1000)::double precision AS "createdAtMs"';
type Query = (sql: string, values?: unknown[]) => Promise<QueryResult>;
async function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  void pending.catch(() => {}); signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Frozen package deadline")); signal.addEventListener("abort", abort, { once: true });
  })]); } finally { if (abort) signal.removeEventListener("abort", abort); }
}
function checkedRow(input: unknown) {
  const row = storedSchema.parse(input), frozen = restoreFrozenPackage(row.payload);
  if (sha256(row.payload) !== row.payloadSha256 || row.manifestSha256 !== frozen.manifestSha256) throw new Error("Frozen package integrity");
  return { row, frozen };
}
function capability(value: ReturnType<typeof checkedRow>): DurableFreeze {
  const { row, frozen } = value;
  const handle = Object.freeze({ id: row.id, manifestSha256: row.manifestSha256, payloadSha256: row.payloadSha256, createdAtMs: row.createdAtMs, purpose: "PREPARATION_ONLY" as const });
  durable.set(handle, frozen); return handle;
}
export function durableBaseline(handle: DurableFreeze): PreparedSnapshot {
  const frozen = durable.get(handle); if (!frozen) throw new Error("INVALID_DURABLE_FREEZE");
  return prepareBaseline(frozen);
}
/** The proposal call is reachable only after a durable commit/load acknowledgement. */
export async function generateDurableDiscountPatch(handle: DurableFreeze, provider: Pick<MetaTaskProvider, "generateSourcePatch">, source: ModelSource): Promise<PreparedSnapshot> {
  const frozen = durable.get(handle); if (!frozen) throw new Error("INVALID_DURABLE_FREEZE");
  const parsed = modelSourceSchema.parse(source), original = readSnapshot(prepareBaseline(frozen)).find(file => file.path === "src/discount.mjs")!;
  if (parsed.issue.number !== 1 || parsed.baseSha !== frozen.manifest.baseSha || parsed.files.length !== 1 || parsed.files[0]!.path !== original.path ||
    parsed.files[0]!.sha256 !== sha256(original.content) || !Buffer.from(parsed.files[0]!.content).equals(original.content)) throw new Error("DURABLE_SOURCE_MISMATCH");
  const response = await provider.generateSourcePatch(parsed, [original.path]);
  const patch = generatedPatchSchema.parse(response.data);
  if (patch.baseSha !== parsed.baseSha) throw new Error("DURABLE_SOURCE_MISMATCH");
  return prepareDiscountPatch(frozen, patch.changes.map(change => ({ ...change, content: Buffer.from(change.content) })));
}

export class PostgresFrozenPackages {
  #pool: Pick<Pool, "connect">;
  constructor(pool: Pick<Pool, "connect">, private readonly timeoutMs = 7000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 7000) throw new Error("Invalid frozen package deadline");
    this.#pool = pool;
  }
  toJSON() { return { store: "postgres-frozen-packages" }; }
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
      const value = await work(query); await query("COMMIT"); return { ok: true, value };
    } catch { release(true); return { ok: false, reason: "UNAVAILABLE" }; }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); release(false); }
  }
  async persist(id: string, frozen: FrozenTest): Promise<JobResult<DurableFreeze | null>> {
    if (!uuid.safeParse(id).success) return { ok: false, reason: "INVALID" };
    let payload: Buffer;
    try { payload = encodeFrozenPackage(frozen); } catch { return { ok: false, reason: "INVALID" }; }
    const payloadSha256 = sha256(payload);
    const result = await this.#transaction(async query => {
      await query('INSERT INTO public."FrozenPreparationPackage" ("id","manifestSha256","payloadSha256","payload") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, frozen.manifestSha256, payloadSha256, payload]);
      const selected = await query(`SELECT ${columns} FROM public."FrozenPreparationPackage" WHERE "id"=$1`, [id]);
      if (!selected.rowCount) return null;
      const checked = checkedRow(selected.rows[0]);
      return checked.row.manifestSha256 === frozen.manifestSha256 && checked.row.payloadSha256 === payloadSha256 ? checked : null;
    });
    // Never mint a patch-generation capability inside an uncertain transaction.
    return result.ok ? { ok: true, value: result.value ? capability(result.value) : null } : result;
  }
  async load(id: string): Promise<JobResult<DurableFreeze | null>> {
    if (!uuid.safeParse(id).success) return { ok: false, reason: "INVALID" };
    const result = await this.#transaction(async query => {
      const selected = await query(`SELECT ${columns} FROM public."FrozenPreparationPackage" WHERE "id"=$1`, [id]);
      return selected.rowCount ? checkedRow(selected.rows[0]) : null;
    });
    return result.ok ? { ok: true, value: result.value ? capability(result.value) : null } : result;
  }
}
