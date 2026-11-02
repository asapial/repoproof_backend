// Trusted application/SQL tests only. No provider or generated source execution.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { databasePoolOptions } from "../src/lib/databasePool";
import { PostgresExecutionJobs, type JobResult } from "../src/execution/jobs";
import { PostgresMetaAccounting, type MetaAccountingAttempt } from "../src/execution/metaAccounting";

function ownedUrl(name: string, user: string) {
  const url = new URL(process.env[name] ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "35440" || url.pathname !== "/rpf_engine_disposable" || url.username !== user || url.password ||
    process.env.RPF_META_ACCOUNTING_GATE !== "1") throw new Error("Owned disposable accounting identities required");
  return url.toString();
}
const accountingUrl = ownedUrl("RPF_META_ACCOUNTING_URL", "rpf_engine_meta_accounting"), workerUrl = ownedUrl("RPF_META_WORKER_URL", "rpf_engine_jobs");
const pool = new Pool({ ...databasePoolOptions(accountingUrl), max: 2 }), worker = new Pool({ ...databasePoolOptions(workerUrl), max: 1 });
const admin = new Pool({ ...databasePoolOptions(ownedUrl("RPF_JOB_ADMIN_URL", "rpf_test")), max: 1 });
pool.on("error", () => {}); worker.on("error", () => {});
const store = new PostgresMetaAccounting(pool), jobs = new PostgresExecutionJobs(worker);
const value = <T>(result: JobResult<T>): T => { assert.equal(result.ok, true, "store available"); if (!result.ok) throw new Error("Store unavailable"); return result.value; };
const requestHash = "a".repeat(64), ownerId = `meta-synthetic-${randomUUID()}`;
const intentInsert = 'INSERT INTO public."MetaAttemptAccounting" ("effectId","jobId","jobVersion","requestHash","model","maxOutputTokens","source","intentSha256") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
async function rolledBackGuard(test: (id: string, effectId: string) => Promise<void>, kind = "META", shortDeadline = false) {
  const id = randomUUID(), effectId = randomUUID(); await admin.query("BEGIN");
  try {
    await admin.query(`INSERT INTO public."ExecutionJob" ("id","ownerId","idempotencyKey","requestHash","state","leaseHash","leaseExpiresAt","deadlineAt")
      VALUES ($1,'meta-guard',$2,$3,'LEASED',$3,clock_timestamp()+$4::interval,clock_timestamp()+$5::interval)`,
    [id,randomUUID(),requestHash,shortDeadline ? "0.5 seconds" : "4 seconds",shortDeadline ? "1 second" : "60 seconds"]);
    await admin.query('INSERT INTO public."ExecutionEffect" ("id","jobId","kind","requestHash") VALUES ($1,$2,$3,$4)', [effectId,id,kind,requestHash]);
    await test(id, effectId);
  } finally { await admin.query("ROLLBACK"); }
}
try {
  assert.equal((await admin.query('SELECT count(*)::int count FROM "ExecutionJob"')).rows[0].count, 0, "exclusive synthetic control database");
  let databaseDenials = 0;
  for (const changed of ["kind", "version", "hash", "job", "cancel"] as const) await rolledBackGuard(async (id, effectId) => {
    if (changed === "cancel") await admin.query('UPDATE "ExecutionJob" SET "cancelRequested"=true,"version"="version"+1 WHERE "id"=$1', [id]);
    const params = [effectId,changed === "job" ? randomUUID() : id,changed === "version" ? 9 : changed === "cancel" ? 2 : 1,
      changed === "hash" ? "b".repeat(64) : requestHash,"synthetic-model",32,"OFFLINE_SYNTHETIC","f".repeat(64)];
    await assert.rejects(admin.query(intentInsert, params), (e: { code?: string }) => e.code === "23514"); databaseDenials++;
  }, changed === "kind" ? "SANDBOX" : "META");
  await rolledBackGuard(async (id, effectId) => {
    await admin.query("SELECT pg_sleep(1.1)");
    await assert.rejects(admin.query(intentInsert, [effectId,id,1,requestHash,"synthetic-model",32,"OFFLINE_SYNTHETIC","f".repeat(64)]),
      (e: { code?: string }) => e.code === "23514"); databaseDenials++;
  }, "META", true);
  // Independent SQL arithmetic/null guards. Each transaction is rolled back;
  // immutable triggers and existing job policy remain enabled throughout.
  for (const counts of [[true,null,4,14,null,null], [true,10,4,15,null,null], [true,10,4,14,11,null],
    [true,10,4,14,null,5], [false,0,0,0,null,null], [true,-1,4,3,null,null], [true,9007199254740992,0,9007199254740992,null,null]]) {
    await rolledBackGuard(async (id, effectId) => {
      await admin.query(intentInsert, [effectId,id,1,requestHash,"synthetic-model",32,"OFFLINE_SYNTHETIC","f".repeat(64)]);
      await assert.rejects(admin.query('INSERT INTO "MetaUsageObservation" ("effectId","outcome","usagePresent","promptTokens","completionTokens","totalTokens","cachedTokens","reasoningTokens","observationSha256") VALUES ($1,\'RECEIVED\',$2,$3,$4,$5,$6,$7,$8)',
        [effectId,...counts,"e".repeat(64)]), (e: { code?: string }) => e.code === "23514"); databaseDenials++;
    });
  }
  await rolledBackGuard(async (id, effectId) => {
    await admin.query(intentInsert, [effectId,id,1,requestHash,"synthetic-model",32,"OFFLINE_SYNTHETIC","f".repeat(64)]);
    await admin.query('INSERT INTO "MetaUsageObservation" ("effectId","outcome","usagePresent","observationSha256") VALUES ($1,\'UNCERTAIN\',false,$2)', [effectId,"e".repeat(64)]);
    const row = (await admin.query('SELECT "usagePresent","promptTokens","totalTokens" FROM "MetaUsageObservation" WHERE "effectId"=$1', [effectId])).rows[0];
    assert.deepEqual(row, { usagePresent: false, promptTokens: null, totalTokens: null });
  });

  // A real worker records only a possible effect, not an actual provider call.
  const jobId = randomUUID(), effectId = randomUUID();
  assert.ok(value(await jobs.submit({ id: jobId, ownerId, idempotencyKey: randomUUID(), requestHash, deadlineAtMs: Date.now()+60000 })));
  const lease = value(await jobs.claim()); assert.ok(lease);
  assert.equal(value(await jobs.recordPossibleEffect(lease, { id: effectId, kind: "META", requestHash })), true);
  const current = value(await jobs.get({ id: jobId, ownerId })); assert.ok(current);
  const attempt: MetaAccountingAttempt = { jobId,effectId,jobVersion: current.version,requestHash,model: "synthetic-model",maxOutputTokens: 32,source: "OFFLINE_SYNTHETIC" };
  for (const changed of [{ jobVersion: current.version+1 }, { jobId: randomUUID() }, { requestHash: "b".repeat(64) }]) assert.equal(value(await store.prepare({ ...attempt,...changed })), null);
  const contenders = Array.from({ length: 8 }, () => new Pool({ ...databasePoolOptions(accountingUrl), max: 1 }));
  try { for (const result of await Promise.all(contenders.map(p => new PostgresMetaAccounting(p).prepare(attempt)))) {
    assert.ok(value(result)); assert.equal(value(result)?.dispatchAllowed, false);
  } } finally { await Promise.all(contenders.map(p => p.end())); }
  assert.equal((await admin.query('SELECT count(*)::int count FROM "MetaAttemptAccounting" WHERE "effectId"=$1', [effectId])).rows[0].count, 1);
  assert.equal(value(await store.prepare({ ...attempt, model: "changed-model" })), null);
  assert.equal(value(await store.prepare({ ...attempt, source: "LIVE_UNVERIFIED" })), null);
  const pending = value(await store.load(effectId)); assert.ok(pending); assert.equal(pending.observation, null);
  assert.equal(pending.noChargeEntitlementVerified, false);
  const cancelled = value(await jobs.cancel({ id: jobId, ownerId })); assert.equal(cancelled?.state, "QUARANTINED");
  assert.ok(value(await store.prepare(attempt)), "old accounting identity remains recoverable after cancellation");
  const lostAck = { connect: async () => {
    const client = await pool.connect();
    return { query: async (sql: string, values?: unknown[]) => { const result = await client.query(sql, values);
      if (sql === "COMMIT") throw new Error("Synthetic lost real committed acknowledgement"); return result; },
    release: (destroy?: boolean) => client.release(destroy) } as PoolClient;
  } };
  const usage = { prompt_tokens: 10, completion_tokens: 33, total_tokens: 43,
    prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 4 } };
  assert.deepEqual(await new PostgresMetaAccounting(lostAck).record({ effectId,outcome: "RECEIVED",usage }), { ok: false, reason: "UNAVAILABLE" });
  const recovered = value(await new PostgresMetaAccounting(pool).load(effectId)); assert.ok(recovered);
  assert.deepEqual(recovered.observation?.usage, usage); assert.equal(recovered.outputLimitExceeded, true); assert.equal(recovered.dispatchAllowed, false);
  assert.ok(value(await store.record({ effectId,outcome: "RECEIVED",usage })));
  assert.equal(value(await store.record({ effectId,outcome: "UNCERTAIN",usage: null })), null);
  assert.equal((await admin.query('SELECT count(*)::int count FROM "MetaUsageObservation" WHERE "effectId"=$1', [effectId])).rows[0].count, 1);
  assert.equal(value(await jobs.claim()), null, "accounting never releases the global quarantined slot");
  const after = value(await jobs.get({ id: jobId, ownerId })); assert.equal(after?.state, "QUARANTINED"); assert.equal(after?.cancelRequested, true);

  let privilegeDenials = 0, ownerImmutabilityDenials = 0;
  for (const sql of ['UPDATE "ExecutionJob" SET "version"="version"+1 WHERE false','INSERT INTO "ExecutionEffect" ("id") VALUES (gen_random_uuid())',
    'SELECT * FROM "user"','SELECT * FROM "Run"','SELECT * FROM "VerificationReport"','SELECT * FROM "_prisma_migrations"',
    'SELECT * FROM "ExecutionReplayGroup"','SELECT * FROM "ExecutionReconciliation"','SELECT * FROM "FrozenPreparationPackage"',
    'UPDATE "MetaAttemptAccounting" SET "model"=\'changed\' WHERE false','DELETE FROM "MetaUsageObservation" WHERE false',
    'TRUNCATE "MetaUsageObservation"']) { await assert.rejects(pool.query(sql), (e: { code?: string }) => e.code === "42501"); privilegeDenials++; }
  for (const table of ["MetaAttemptAccounting","MetaUsageObservation"]) {
    for (const sql of [`UPDATE "${table}" SET "effectId"="effectId" WHERE "effectId"=$1`, `DELETE FROM "${table}" WHERE "effectId"=$1`]) {
      await assert.rejects(admin.query(sql,[effectId]), (e: { code?: string }) => e.code === "55000"); ownerImmutabilityDenials++;
    }
    // The FK requires both tables in an intent TRUNCATE. It remains forbidden.
    const sql = table === "MetaAttemptAccounting" ? 'TRUNCATE "MetaAttemptAccounting","MetaUsageObservation"' : 'TRUNCATE "MetaUsageObservation"';
    await assert.rejects(admin.query(sql), (e: { code?: string }) => e.code === "55000"); ownerImmutabilityDenials++;
  }
  const product = (await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports')).rows[0];
  assert.deepEqual(product, { runs: 0, reports: 0 });
  console.log(JSON.stringify({ result: "PASS", concurrentClients: 8, databaseDenials, privilegeDenials, ownerImmutabilityDenials,
    committedLostAckRecovered: true, lateCancelledUsageRetained: true, actualProviderCalls: 0, dispatchAllowed: false,
    retainedImmutableSyntheticIdentity: { jobId,effectId,ownerId }, globalSlot: "QUARANTINED", ...product }));
} finally {
  // Immutable synthetic accounting and the referenced possible-effect job remain
  // in the owned tmpfs DB. No cleanup bypass or quarantine-release workaround.
  await Promise.all([pool.end(),worker.end(),admin.end()]);
}
