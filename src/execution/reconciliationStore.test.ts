import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { PostgresReconciliations } from "./reconciliationStore";

const id = "10000000-0000-4000-8000-000000000001";
describe("bounded durable reconciliation store", () => {
  it("rejects forged handles and malformed IDs before connecting", async () => {
    const connect = vi.fn(), store = new PostgresReconciliations({ connect });
    expect(await store.append({} as never)).toEqual({ ok: false, reason: "INVALID" });
    expect(await store.context("bad", id)).toEqual({ ok: false, reason: "INVALID" });
    expect(await store.load("bad")).toEqual({ ok: false, reason: "INVALID" });
    expect(connect).not.toHaveBeenCalled(); expect(JSON.stringify(store)).toBe('{"store":"postgres-reconciliation"}');
  });
  it("bounds stalled connect and destroys a late client", async () => {
    let resolve!: (client: PoolClient) => void;
    const release = vi.fn(), connect = vi.fn(() => new Promise<PoolClient>(done => { resolve = done; }));
    const store = new PostgresReconciliations({ connect }, 10);
    expect(await store.context(id, id)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    resolve({ release } as unknown as PoolClient); await Promise.resolve(); await Promise.resolve();
    expect(release).toHaveBeenCalledExactlyOnceWith(true); expect(connect).toHaveBeenCalledTimes(1);
  });
  it("disposes stalled query clients once and hides raw driver failures", async () => {
    for (const query of [vi.fn(() => new Promise(() => {})), vi.fn(async () => { throw new Error("synthetic-secret-canary"); })]) {
      const release = vi.fn(), pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pick<Pool, "connect">;
      const result = await new PostgresReconciliations(pool, 10).load(id);
      expect(result).toEqual({ ok: false, reason: "UNAVAILABLE" }); expect(JSON.stringify(result)).not.toContain("canary");
      expect(release).toHaveBeenCalledExactlyOnceWith(true);
    }
  });
  it("returns unavailable after a lost commit acknowledgement without retry", async () => {
    const release = vi.fn(), query = vi.fn(async (text: string) => {
      if (text === "COMMIT") throw new Error("Synthetic acknowledgement loss");
      return { rowCount: 0, rows: [] };
    });
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pick<Pool, "connect">;
    expect(await new PostgresReconciliations(pool).load(id)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(query.mock.calls.filter(([text]) => text === "COMMIT")).toHaveLength(1);
    expect(pool.connect).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
