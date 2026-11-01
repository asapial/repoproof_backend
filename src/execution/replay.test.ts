import { expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { PostgresExecutionReplay } from "./replay";
const request = () => ({ namespace: "ISOLATION" as const, groupId: randomUUID(), entries: [{ itemId: randomUUID(), nonce: "a".repeat(64) }], expiresAtMs: Date.now()+60000 });
it("fails closed before connecting on duplicate/invalid identity or oversized groups", async () => {
  const pool = { connect: vi.fn() }; const store = new PostgresExecutionReplay(pool as unknown as Pool);
  const duplicate = request(); duplicate.entries.push(duplicate.entries[0]!);
  for (const value of [duplicate,{ ...request(), groupId: "BAD" },{ ...request(), entries: [] },{ ...request(), entries: Array.from({ length: 17 },() => request().entries[0]!) }]) expect(await store.reserve(value)).toBe(false);
  expect(pool.connect).not.toHaveBeenCalled();
});
it("does not disclose pool failures or serialize connection credentials", async () => {
  const pool = { connect: vi.fn(async () => { throw new Error("postgresql://private-password"); }) };
  const store = new PostgresExecutionReplay(pool as unknown as Pool);
  expect(await store.reserve(request())).toBe(false); expect(JSON.stringify(store)).toBe('{"store":"postgres-execution-replay"}');
});
it("bounds an unresponsive pool and discards a late connection", async () => {
  let resolveConnection!: (client: PoolClient) => void;
  const pool = { connect: vi.fn(() => new Promise<PoolClient>(resolve => { resolveConnection = resolve; })) };
  const store = new PostgresExecutionReplay(pool as unknown as Pool,10);
  expect(await store.reserve(request())).toBe(false);
  const release = vi.fn(); resolveConnection({ release } as unknown as PoolClient);
  await vi.waitFor(() => expect(release).toHaveBeenCalledWith(true));
});
