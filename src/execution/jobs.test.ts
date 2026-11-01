import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ExecutionLease, PostgresExecutionJobs } from "./jobs";

const request = () => ({ id: randomUUID(), ownerId: "owned-user", idempotencyKey: randomUUID(), requestHash: "a".repeat(64), deadlineAtMs: Date.now()+60000 });
it("rejects unbounded or malformed owner/job/effect inputs before SQL", async () => {
  const connect = vi.fn(), store = new PostgresExecutionJobs({ connect } as unknown as Pool);
  for (const input of [{ ...request(), ownerId: "x".repeat(129) },{ ...request(), ownerId: "user\nsecret" },{ ...request(), id: "BAD" },{ ...request(), requestHash: "A".repeat(64) },{ ...request(), deadlineAtMs: NaN }]) expect(await store.submit(input)).toEqual({ ok: false, reason: "INVALID" });
  expect(await store.get({ ownerId: "", id: randomUUID() })).toEqual({ ok: false, reason: "INVALID" });
  expect(await store.cancel({ ownerId: "owned-user", id: "not-uuid" })).toEqual({ ok: false, reason: "INVALID" });
  expect(connect).not.toHaveBeenCalled();
});
it("cannot reconstruct a lease proof from a forged or serialized status", async () => {
  const connect = vi.fn(), store = new PostgresExecutionJobs({ connect } as unknown as Pool);
  const forged = new ExecutionLease({ id: randomUUID(), state: "LEASED", version: 1, attempts: 1, cancelRequested: false, deadlineAtMs: Date.now()+5000 });
  expect(await store.release(forged)).toEqual({ ok: false, reason: "INVALID" });
  expect(await store.recordPossibleEffect(forged,{ id: randomUUID(), kind: "META", requestHash: "a".repeat(64) })).toEqual({ ok: false, reason: "INVALID" });
  expect(await store.release(JSON.parse(JSON.stringify(forged)))).toEqual({ ok: false, reason: "INVALID" });
  expect(connect).not.toHaveBeenCalled();
});
it("redacts driver errors and does not retry unknown transaction outcomes", async () => {
  const connect = vi.fn(async () => { throw new Error("postgresql://private-password"); });
  const store = new PostgresExecutionJobs({ connect } as unknown as Pool);
  expect(await store.submit(request())).toEqual({ ok: false, reason: "UNAVAILABLE" });
  expect(connect).toHaveBeenCalledTimes(1); expect(JSON.stringify(store)).toBe('{"store":"postgres-execution-jobs"}');
});
it("bounds an unresponsive connection and destroys a late connection", async () => {
  let resolveConnection!: (client: PoolClient) => void;
  const connect = vi.fn(() => new Promise<PoolClient>(resolve => { resolveConnection=resolve; }));
  const store = new PostgresExecutionJobs({ connect } as unknown as Pool,10);
  expect(await store.recover()).toEqual({ ok: false, reason: "UNAVAILABLE" });
  const release = vi.fn(); resolveConnection({ release } as unknown as PoolClient);
  await vi.waitFor(() => expect(release).toHaveBeenCalledWith(true));
  expect(connect).toHaveBeenCalledTimes(1);
});
