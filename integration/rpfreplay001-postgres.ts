// Application SQL only. No fixture, model, Sandbox or user repository execution.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresExecutionReplay } from "../src/execution/replay";
import { databasePoolOptions } from "../src/lib/databasePool";

const runtime = new URL(process.env.DATABASE_URL ?? ""), owner = new URL(process.env.RPF_REPLAY_ADMIN_URL ?? "");
for (const value of [runtime,owner]) if (value.hostname !== "127.0.0.1" || value.port !== "35440" || value.pathname !== "/rpf_engine_disposable") throw new Error("Owned disposable replay database required");
if (runtime.username !== "rpf_engine_replay" || owner.username !== "rpf_test" || process.env.RPF_REPLAY_GATE !== "1") throw new Error("Limited disposable replay identities required");
const pool = new Pool({ ...databasePoolOptions(runtime.toString()), max: 2 }); pool.on("error",() => {});
const admin = new Pool({ ...databasePoolOptions(owner.toString()), max: 1 });
const store = new PostgresExecutionReplay(pool); const groups: string[] = [];
const reservation = () => { const groupId = randomUUID(); groups.push(groupId); return { namespace: "ISOLATION" as const, groupId, entries: Array.from({ length: 2 },() => ({ itemId: randomUUID(), nonce: randomBytes(32).toString("hex") })), expiresAtMs: Date.now()+60000 }; };
try {
  const before = await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports');
  const first = reservation(); assert.equal(await store.reserve(first),true); assert.equal(await store.reserve(first),false);
  const itemCollision = reservation(); itemCollision.entries[0]!.itemId = first.entries[0]!.itemId; assert.equal(await store.reserve(itemCollision),false);
  const nonceCollision = reservation(); nonceCollision.entries[1]!.nonce = first.entries[0]!.nonce; assert.equal(await store.reserve(nonceCollision),false);
  const partial = await admin.query('SELECT count(*)::int count FROM "ExecutionReplayGroup" WHERE "groupId"=ANY($1::uuid[])',[[itemCollision.groupId,nonceCollision.groupId]]); assert.equal(partial.rows[0].count,0,"conflicting batch entirely rolls back");
  for (const expiresAtMs of [Date.now()-1000,Date.now()+360000]) assert.equal(await store.reserve({ ...reservation(), expiresAtMs }),false,"database clock rejects stale/far future");
  const racing = reservation(); const contenders = Array.from({ length: 8 },() => new Pool({ ...databasePoolOptions(runtime.toString()), max: 1 }));
  try { assert.equal((await Promise.all(contenders.map(client => new PostgresExecutionReplay(client).reserve(racing)))).filter(Boolean).length,1,"one of eight independent PG sessions wins"); }
  finally { await Promise.all(contenders.map(client => client.end())); }
  const denied = ['SELECT * FROM "user"','SELECT * FROM "Run"','SELECT * FROM "_prisma_migrations"','CREATE TABLE public.replay_should_not_exist(id int)','UPDATE "ExecutionReplayGroup" SET "expiresAt"=clock_timestamp()','DELETE FROM "ExecutionReplayItem"','SET ROLE rpf_test'];
  for (const query of denied) await assert.rejects(pool.query(query),{ code: "42501" });
  const holder = await admin.connect(); const blocked = reservation();
  try {
    await holder.query("BEGIN"); await holder.query('INSERT INTO "ExecutionReplayGroup" ("namespace","groupId","expiresAt") VALUES ($1,$2,clock_timestamp()+interval \'1 minute\')',[blocked.namespace,blocked.groupId]);
    const start = Date.now(); assert.equal(await new PostgresExecutionReplay(pool,100).reserve(blocked),false); assert.ok(Date.now()-start<2000,"bounded connection/index contention");
    await holder.query("ROLLBACK"); assert.equal(await store.reserve(blocked),true,"aborted transaction leaves no partial reservation");
  } finally { await holder.query("ROLLBACK"); holder.release(); }
  const after = await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports'); assert.deepEqual(after.rows,before.rows); assert.equal(after.rows[0].runs,0);
  console.log("PASS: real restricted-role PostgreSQL atomic pair reservation, replay/item/nonce collisions, rollback, DB-clock expiry, 8-session concurrency, permission denials and deadline recovery; zero product runs/reports.");
} finally {
  // Remove only this test's synthetic groups/items; the worker role cannot delete.
  await admin.query('DELETE FROM "ExecutionReplayItem" WHERE "groupId"=ANY($1::uuid[])',[groups]);
  await admin.query('DELETE FROM "ExecutionReplayGroup" WHERE "groupId"=ANY($1::uuid[])',[groups]);
  await pool.end(); await admin.end();
}
