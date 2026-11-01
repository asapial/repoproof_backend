// Trusted application SQL tests only. No model, fixture or provider execution.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { PostgresExecutionJobs, type ExecutionLease, type JobResult, type JobSubmission } from "../src/execution/jobs";
import { databasePoolOptions } from "../src/lib/databasePool";

const runtime = new URL(process.env.DATABASE_URL ?? ""), owner = new URL(process.env.RPF_JOB_ADMIN_URL ?? "");
for (const value of [runtime,owner]) if (value.hostname!=="127.0.0.1" || value.port!=="35440" || value.pathname!=="/rpf_engine_disposable") throw new Error("Owned disposable job database required");
if (runtime.username!=="rpf_engine_jobs" || owner.username!=="rpf_test" || process.env.RPF_JOB_GATE!=="1") throw new Error("Limited disposable job identities required");
const pool = new Pool({ ...databasePoolOptions(runtime.toString()), max: 2 }); pool.on("error",() => {});
const admin = new Pool({ ...databasePoolOptions(owner.toString()), max: 1 });
const store = new PostgresExecutionJobs(pool), ids: string[] = [];
const value = <T>(result: JobResult<T>): T => { assert.equal(result.ok,true,"store available"); if (!result.ok) throw new Error("Store unavailable"); return result.value; };
const ownerA = `job-a-${randomUUID()}`, ownerB = `job-b-${randomUUID()}`;
const request = (ownerId=ownerA, ttl=60000): JobSubmission => { const id=randomUUID(); ids.push(id); return { id, ownerId, idempotencyKey: randomUUID(), requestHash: "a".repeat(64), deadlineAtMs: Date.now()+ttl }; };
const get = async (id: string) => value(await store.get({ ownerId: ownerA, id }));
const claim = async (): Promise<ExecutionLease> => { const lease=value(await store.claim()); assert.ok(lease); return lease; };
const cancel = async (id: string) => value(await store.cancel({ ownerId: ownerA, id }));
try {
  const before=await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports');
  assert.equal((await admin.query('SELECT count(*)::int count FROM "ExecutionJob"')).rows[0].count,0,"exclusive synthetic test database");
  const first=request(); assert.equal(value(await store.submit(first))?.id,first.id);
  assert.equal(value(await store.submit({ ...first, id: randomUUID(), deadlineAtMs: Date.now()+120000 }))?.deadlineAtMs,first.deadlineAtMs,"idempotent retry cannot extend deadline");
  assert.equal(value(await store.submit({ ...first, requestHash: "b".repeat(64) })),null,"idempotency body conflict rejected");
  assert.equal(value(await store.get({ ownerId: ownerB, id: first.id })),null);
  assert.equal(value(await store.cancel({ ownerId: ownerB, id: first.id })),null,"other owner cannot cancel");
  const second=request(ownerB); second.idempotencyKey=first.idempotencyKey; assert.equal(value(await store.submit(second))?.id,second.id,"keys scoped to owner");
  value(await store.cancel({ ownerId: ownerB, id: second.id }));
  for (const ttl of [-1000,360000]) assert.equal(value(await store.submit(request(ownerA,ttl))),null,"database clock bounds job deadline");

  const contenders=Array.from({ length: 8 },() => new Pool({ ...databasePoolOptions(runtime.toString()), max: 1 }));
  let lease: ExecutionLease;
  try {
    const claimed=await Promise.all(contenders.map(client => new PostgresExecutionJobs(client).claim()));
    const winners=claimed.filter(result => result.ok && result.value!==null);
    assert.equal(winners.length,1,"one global lease across eight independent connections");
    lease=value(winners[0]!)!;
  } finally { await Promise.all(contenders.map(client => client.end())); }
  const serialized=JSON.stringify(lease); assert.ok(!serialized.includes("leaseHash") && !serialized.includes("requestHash") && !serialized.includes(ownerA));
  assert.equal(value(await store.release(lease)),true); assert.equal(value(await store.release(lease)),false,"stale CAS cannot transition again");
  for (let attempt=2;attempt<=3;attempt++) { const next=await claim(); assert.equal(next.job.attempts,attempt); assert.equal(value(await store.release(next)),true); }
  assert.equal((await get(first.id))?.state,"EXPIRED","no-effect retries stop at three attempts");

  const crash=request(); value(await store.submit(crash)); const lost=await claim();
  // Database time advances the lease; no model/VM/background worker is involved.
  await admin.query('SELECT pg_sleep(2.6)'); await admin.query('SELECT pg_sleep(2.6)');
  assert.equal(value(await store.recover()),1);
  assert.equal(value(await store.release(lost)),false); assert.equal((await get(crash.id))?.state,"QUEUED");
  const recovered=await claim(); assert.ok(recovered.job.version>lost.job.version); await cancel(crash.id);
  assert.equal(value(await store.release(recovered)),false,"cancellation invalidates an active lease");
  const short=request(ownerA,1000); value(await store.submit(short)); await admin.query('SELECT pg_sleep(1.1)');
  assert.equal(value(await store.recover()),1); assert.equal((await get(short.id))?.state,"EXPIRED");

  const held=request(); const blocker=await admin.connect();
  try {
    await blocker.query("BEGIN"); await blocker.query('INSERT INTO "ExecutionJob" ("id","ownerId","idempotencyKey","requestHash","deadlineAt") VALUES ($1,$2,$3,$4,clock_timestamp()+interval \'1 minute\')',[held.id,held.ownerId,held.idempotencyKey,held.requestHash]);
    const started=Date.now(); const uncertain=await new PostgresExecutionJobs(pool,100).submit(held);
    assert.deepEqual(uncertain,{ ok: false, reason: "UNAVAILABLE" }); assert.ok(Date.now()-started<2000);
    await blocker.query("ROLLBACK"); assert.ok(value(await store.submit(held))); await cancel(held.id);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }

  const committed=request();
  const lostAckPool={ connect: async () => {
    const client=await pool.connect();
    return { query: async (text: string, values?: unknown[]) => {
      const result=await client.query(text,values);
      if (text==='COMMIT') throw new Error("Synthetic lost commit acknowledgement");
      return result;
    }, release: (destroy?: boolean) => client.release(destroy) } as PoolClient;
  } };
  assert.deepEqual(await new PostgresExecutionJobs(lostAckPool).submit(committed),{ ok: false, reason: "UNAVAILABLE" });
  assert.equal((await get(committed.id))?.id,committed.id,"unknown acknowledgement can hide a committed job");
  assert.equal(value(await store.submit(committed))?.id,committed.id,"caller retains original idempotency identity");
  await cancel(committed.id);

  const racing=request(); value(await store.submit(racing)); const racingLease=await claim();
  const raceEffect={ id: randomUUID(), kind: "META" as const, requestHash: "c".repeat(64) };
  const raceResults=await Promise.all([store.cancel({ ownerId: ownerA, id: racing.id }),store.recordPossibleEffect(racingLease,raceEffect)]);
  for (const result of raceResults) assert.equal(result.ok,true);
  const raceRow=await get(racing.id), raceCount=await admin.query('SELECT count(*)::int count FROM "ExecutionEffect" WHERE "jobId"=$1',[racing.id]);
  assert.equal(raceRow?.cancelRequested,true);
  assert.equal(raceRow?.state,raceCount.rows[0].count===1 ? "QUARANTINED" : "CANCELLED","cancel/intent race is atomic");
  // Both contenders are synthetic SQL only. Release this test's quarantined row.
  await admin.query('DELETE FROM "ExecutionEffect" WHERE "jobId"=$1',[racing.id]);
  await admin.query('DELETE FROM "ExecutionJob" WHERE "id"=$1',[racing.id]);

  const known=request(); value(await store.submit(known)); const knownLease=await claim();
  assert.equal(value(await store.recordPossibleEffect(knownLease,{ id: randomUUID(), kind: "META", requestHash: "c".repeat(64) })),true);
  assert.equal((await get(known.id))?.state,"QUARANTINED");
  await admin.query('DELETE FROM "ExecutionEffect" WHERE "jobId"=$1',[known.id]);
  await admin.query('DELETE FROM "ExecutionJob" WHERE "id"=$1',[known.id]);

  const possible=request(), queued=request(); value(await store.submit(possible)); value(await store.submit(queued));
  const beforeEffect=await claim(); assert.equal(beforeEffect.job.id,possible.id);
  const effect={ id: randomUUID(), kind: "SANDBOX" as const, requestHash: "b".repeat(64) };
  assert.deepEqual(await new PostgresExecutionJobs(lostAckPool).recordPossibleEffect(beforeEffect,effect),{ ok: false, reason: "UNAVAILABLE" });
  assert.equal((await get(possible.id))?.state,"QUARANTINED","unknown effect commit acknowledgement retains slot");
  assert.equal(value(await store.recordPossibleEffect(beforeEffect,effect)),false,"uncertain create intent never rearmed");
  assert.equal((await get(possible.id))?.state,"QUARANTINED");
  assert.equal(value(await store.release(beforeEffect)),false); await cancel(possible.id);
  assert.equal((await get(possible.id))?.state,"QUARANTINED","cancellation cannot invent cleanup");
  assert.equal((await get(possible.id))?.cancelRequested,true);
  assert.equal(value(await store.recover()),0); assert.equal(value(await store.claim()),null,"quarantine retains global slot");
  assert.equal((await get(queued.id))?.state,"QUEUED");
  await assert.rejects(pool.query('UPDATE "ExecutionJob" SET "state"=\'LEASED\',"version"="version"+1,"attempts"="attempts"+1,"leaseHash"=repeat(\'c\',64),"leaseExpiresAt"=least("deadlineAt",clock_timestamp()+interval \'5 seconds\') WHERE "id"=$1',[queued.id]),{ code: "23505" });
  await assert.rejects(pool.query('UPDATE "ExecutionJob" SET "state"=\'QUEUED\',"version"="version"+1 WHERE "id"=$1',[possible.id]),{ code: "23514" });
  await assert.rejects(pool.query('UPDATE "ExecutionJob" SET "deadlineAt"="deadlineAt"+interval \'1 second\',"version"="version"+1 WHERE "id"=$1',[queued.id]),{ code: "23514" });
  const denied=['SELECT * FROM "user"','SELECT * FROM "Run"','SELECT * FROM "_prisma_migrations"','SELECT * FROM "ExecutionReplayItem"','DELETE FROM "ExecutionJob"','DELETE FROM "ExecutionEffect"','UPDATE "ExecutionEffect" SET "kind"=\'META\'','CREATE TABLE public.jobs_should_not_exist(id int)','SET ROLE rpf_test'];
  for (const query of denied) await assert.rejects(pool.query(query),{ code: "42501" });
  const after=await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports');
  assert.deepEqual(after.rows,before.rows); assert.equal(after.rows[0].runs,0); assert.equal(after.rows[0].reports,0);
  console.log("PASS: real restricted-role PostgreSQL owner/idempotency isolation, eight-session global claim, CAS, bounded retries, crash/deadline recovery, cancellation, uncertain-effect quarantine, nine privilege denials and zero product runs/reports.");
} finally {
  // Only this test's synthetic rows; worker cannot delete or unquarantine them.
  await admin.query('DELETE FROM "ExecutionEffect" WHERE "jobId"=ANY($1::uuid[])',[ids]);
  await admin.query('DELETE FROM "ExecutionJob" WHERE "id"=ANY($1::uuid[])',[ids]);
  await pool.end(); await admin.end();
}
