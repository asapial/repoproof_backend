import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { IsolationReplayStore } from "../isolation/assessment";

const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const requestSchema = z.object({ namespace: z.enum(["ISOLATION", "RUNNER_REQUEST", "RUNNER_EVIDENCE"]), groupId: uuid,
  entries: z.array(z.object({ itemId: uuid, nonce: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(16),
  expiresAtMs: z.number().int().positive().safe() }).strict();
export type ReplayReservation = z.infer<typeof requestSchema>;

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  void promise.catch(() => {}); signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try { return await Promise.race([promise,new Promise<never>((_resolve,reject) => { abort = () => reject(new Error("Replay deadline")); signal.addEventListener("abort",abort,{ once: true }); })]); }
  finally { if (abort) signal.removeEventListener("abort",abort); }
}

export class PostgresExecutionReplay implements IsolationReplayStore {
  #pool: Pick<Pool, "connect">;
  constructor(pool: Pick<Pool, "connect">, private readonly deadlineMs = 7000) {
    if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 7000) throw new Error("Invalid replay deadline");
    this.#pool = pool;
  }
  toJSON() { return { store: "postgres-execution-replay" }; }
  async reserve(input: ReplayReservation): Promise<boolean> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return false;
    const value = parsed.data;
    if (new Set(value.entries.map(item => item.itemId)).size !== value.entries.length || new Set(value.entries.map(item => item.nonce)).size !== value.entries.length) return false;
    let client: PoolClient | undefined; let released = false;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),this.deadlineMs);
    const release = (destroy: boolean) => { if (client && !released) { released = true; try { client.release(destroy); } catch { /* Fixed public failure only. */ } } };
    const abort = () => release(true); controller.signal.addEventListener("abort",abort,{ once: true });
    try {
      // Use a trusted bounded shared pool. Transaction-local timeouts also bound
      // unique-index contention and ensure no partial group survives a failure.
      const connection = this.#pool.connect();
      void connection.then(late => { if (controller.signal.aborted) { try { late.release(true); } catch { /* Late connection discarded. */ } } },() => {});
      client = await bounded(connection,controller.signal);
      const query = (text: string, values?: unknown[]) => { controller.signal.throwIfAborted(); return bounded(client!.query(text,values),controller.signal); };
      await query("BEGIN");
      await query("SET LOCAL statement_timeout = '2s'");
      await query("SET LOCAL lock_timeout = '2s'");
      const group = await query(`INSERT INTO "ExecutionReplayGroup" ("namespace","groupId","createdAt","expiresAt")
        SELECT $1,$2,clock_timestamp(),to_timestamp($3::double precision / 1000)
        WHERE to_timestamp($3::double precision / 1000) > clock_timestamp()
          AND to_timestamp($3::double precision / 1000) <= clock_timestamp() + interval '5 minutes'
        ON CONFLICT DO NOTHING RETURNING "groupId"`, [value.namespace,value.groupId,value.expiresAtMs]);
      if (group.rowCount !== 1) { await query("ROLLBACK"); return false; }
      const items = await query(`INSERT INTO "ExecutionReplayItem" ("namespace","groupId","itemId","nonce")
        SELECT $1,$2,entry.id,entry.nonce FROM unnest($3::uuid[],$4::text[]) AS entry(id,nonce)
        ON CONFLICT DO NOTHING RETURNING "itemId"`, [value.namespace,value.groupId,value.entries.map(item => item.itemId),value.entries.map(item => item.nonce)]);
      if (items.rowCount !== value.entries.length) { await query("ROLLBACK"); return false; }
      await query("COMMIT"); return true;
    } catch {
      // Destroy an uncertain connection rather than awaiting another potentially
      // stuck rollback after the deadline. Server disconnect rolls it back.
      release(true);
      return false;
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort",abort); release(false); }
  }
  consume(input: { evidenceIds: [string,string]; nonces: [string,string]; auditId: string; expiresAtMs: number }): Promise<boolean> {
    return this.reserve({ namespace: "ISOLATION", groupId: input.auditId, entries: input.evidenceIds.map((itemId,index) => ({ itemId, nonce: input.nonces[index]! })), expiresAtMs: input.expiresAtMs });
  }
}
