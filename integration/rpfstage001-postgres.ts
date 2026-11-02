// Trusted metadata and SQL only. No source, test, model or provider execution.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { databasePoolOptions } from "../src/lib/databasePool";
import { restoreFrozenPackage } from "../src/verification/frozenPackage";
import { nextStage, PostgresStageJournal, type StageCommand, type StageRecord, type StageView } from "../src/execution/stageJournal";
import type { JobResult } from "../src/execution/jobs";

function url(name: string, user: string) {
  const value = new URL(process.env[name] ?? "");
  if (value.hostname !== "127.0.0.1" || value.port !== "35440" || value.pathname !== "/rpf_engine_disposable" || value.username !== user || value.password || process.env.RPF_STAGE_GATE !== "1") throw new Error("Owned disposable stage identities required");
  return value.toString();
}
const journalUrl = url("RPF_STAGE_DATABASE_URL","rpf_engine_journal"), pool = new Pool({ ...databasePoolOptions(journalUrl),max: 2 }); pool.on("error",() => {});
const admin = new Pool({ ...databasePoolOptions(url("RPF_JOB_ADMIN_URL","rpf_test")),max: 1 }), store = new PostgresStageJournal(pool);
const value = <T>(r: JobResult<T>): T => { assert.equal(r.ok,true,"store available"); if (!r.ok) throw new Error("Store unavailable"); return r.value; };
const requireView = (r: JobResult<StageView | null>) => { const v = value(r); assert.ok(v); assert.equal(v.dispatchAllowed,false); assert.equal(v.productionVerdict,"INCONCLUSIVE"); return v; };
const flowIds: string[] = [], requestHash = "a".repeat(64);
async function open(ttl = 60000) { const flowId = randomUUID(); flowIds.push(flowId); return requireView(await store.open({ flowId,requestHash,deadlineAtMs: Date.now()+ttl })); }
function command(p: StageView, kind: StageCommand["kind"], outcome: StageCommand["outcome"], frozenPackageId = p.record.frozenPackageId, frozenManifestSha256 = p.record.frozenManifestSha256): StageCommand {
  return { flowId: p.record.flowId,expectedSequence: p.record.sequence,expectedRecordSha256: p.recordSha256,kind,outcome,
    referenceSha256: kind === "FREEZE" ? frozenManifestSha256! : "b".repeat(64),frozenPackageId,frozenManifestSha256 };
}
async function insert(r: StageRecord, digest?: string, connection: Pick<Pool,"query"> | Pick<PoolClient,"query"> = pool) {
  const payload = Buffer.from(JSON.stringify(r));
  return connection.query(`INSERT INTO "ExecutionStageJournal" ("flowId","sequence","previousSha256","requestHash","deadlineAtMs","kind","outcome","referenceSha256","frozenPackageId","frozenManifestSha256","state","cancelRequested","payload","recordSha256")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [r.flowId,r.sequence,r.previousSha256,r.requestHash,r.deadlineAtMs,r.kind,r.outcome,r.referenceSha256,
      r.frozenPackageId,r.frozenManifestSha256,r.state,r.cancelRequested,payload,digest ?? createHash("sha256").update(payload).digest("hex")]);
}
try {
  const earlier = (await admin.query('SELECT DISTINCT "flowId" FROM "ExecutionStageJournal"')).rows;
  for (const row of earlier) requireView(await store.load(row.flowId));
  const controlsBefore = (await admin.query('SELECT "id","state","version","cancelRequested" FROM "ExecutionJob" ORDER BY "id"')).rows;
  assert.equal(controlsBefore.length,1); assert.equal(controlsBefore[0].state,"QUARANTINED");
  let sealed: { id: string; manifestSha256: string } | undefined;
  for (const row of (await admin.query('SELECT "id","manifestSha256","payload" FROM "FrozenPreparationPackage"')).rows) {
    try { if (restoreFrozenPackage(row.payload).manifestSha256 === row.manifestSha256) { sealed = row; break; } } catch { /* Retained malformed negative packet is not used. */ }
  }
  assert.ok(sealed);
  let full = await open(); const original = full, intake = command(full,"INTAKE","ALLOWED");
  const contenders = Array.from({ length: 8 },() => new Pool({ ...databasePoolOptions(journalUrl),max: 1 }));
  try { for (const r of await Promise.all(contenders.map(p => new PostgresStageJournal(p).append(intake)))) assert.equal(requireView(r).record.state,"INTAKE_ACCEPTED"); }
  finally { await Promise.all(contenders.map(p => p.end())); }
  full = requireView(await store.load(full.record.flowId));
  const freeze = command(full,"FREEZE","ALLOWED",sealed.id,sealed.manifestSha256);
  const lostAck = { connect: async () => { const client = await pool.connect(); return {
    query: async (sql: string, values?: unknown[]) => { const r = await client.query(sql,values); if (sql === "COMMIT") throw new Error("Synthetic lost actual commit acknowledgement"); return r; },
    release: (destroy?: boolean) => client.release(destroy) } as PoolClient; } };
  assert.deepEqual(await new PostgresStageJournal(lostAck).append(freeze),{ ok: false,reason: "UNAVAILABLE" });
  full = requireView(await new PostgresStageJournal(pool).load(full.record.flowId)); assert.equal(full.record.state,"FROZEN");
  assert.ok(value(await store.append(freeze)));
  for (const [kind,outcome] of [["BASELINE_ISSUE","ASSERTION_FAILURE"],["BASELINE_REGRESSIONS","PASS"],["PATCH_PREPARED","ALLOWED"],["PATCHED_ISSUE","PASS"],["PATCHED_REGRESSIONS","PASS"]] as const) full = requireView(await store.append(command(full,kind,outcome)));
  assert.equal(full.record.state,"AWAITING_TRUST_REVIEW"); assert.equal(full.record.sequence,7);
  assert.equal(requireView(await store.append(intake)).record.sequence,7,"old exact acknowledgement returns latest replayed state");
  assert.equal(value(await store.append({ ...intake,outcome: "DENIED" })),null);
  assert.equal(value(await store.append({ ...intake,expectedRecordSha256: "0".repeat(64) })),null);

  let noRepro = await open(); noRepro = requireView(await store.append(command(noRepro,"INTAKE","ALLOWED")));
  noRepro = requireView(await store.append(command(noRepro,"FREEZE","ALLOWED",sealed.id,sealed.manifestSha256)));
  noRepro = requireView(await store.append(command(noRepro,"BASELINE_ISSUE","PASS"))); assert.equal(noRepro.record.state,"NO_REPRO_PREPARATION");
  assert.deepEqual(await store.append(command(noRepro,"PATCH_PREPARED","ALLOWED")),{ ok: false,reason: "UNAVAILABLE" });
  assert.equal((await admin.query('SELECT count(*)::int n FROM "ExecutionStageJournal" WHERE "flowId"=$1 AND "kind"=\'PATCH_PREPARED\'',[noRepro.record.flowId])).rows[0].n,0);
  let unknown = await open(); unknown = requireView(await store.append(command(unknown,"INTAKE","UNCERTAIN")));
  unknown = requireView(await store.append(command(unknown,"CANCEL","NONE"))); assert.equal(unknown.record.state,"QUARANTINED"); assert.equal(unknown.record.cancelRequested,true);
  let cancelled = await open(); cancelled = requireView(await store.append(command(cancelled,"CANCEL","NONE"))); assert.equal(cancelled.record.state,"CANCELLED");
  let expired = await open(400); await admin.query("SELECT pg_sleep(0.5)");
  assert.deepEqual(await store.append(command(expired,"INTAKE","ALLOWED")),{ ok: false,reason: "UNAVAILABLE" });
  expired = requireView(await store.append(command(expired,"EXPIRE","NONE"))); assert.equal(expired.record.state,"EXPIRED");
  assert.equal(requireView(await store.load(original.record.flowId)).record.state,"AWAITING_TRUST_REVIEW");

  let databaseDenials = 0;
  const candidate = nextStage(original.record,intake,Date.now());
  for (const changed of [{ sequence: 9 },{ previousSha256: "0".repeat(64) },{ deadlineAtMs: candidate.deadlineAtMs+1 },{ requestHash: "c".repeat(64) },
    { kind: "PATCH_PREPARED",state: "PATCH_READY" },{ state: "AWAITING_TRUST_REVIEW" },{ frozenPackageId: sealed.id,frozenManifestSha256: sealed.manifestSha256 }]) {
    const client = await pool.connect(); await client.query("BEGIN");
    try {
      const root = { ...original.record,flowId: randomUUID() }; await insert(root,undefined,client);
      const next = nextStage(root,{ ...intake,flowId: root.flowId,expectedRecordSha256: createHash("sha256").update(JSON.stringify(root)).digest("hex") },Date.now());
      await assert.rejects(insert(Object.assign({ ...next },changed),undefined,client),(e: { code?: string }) => e.code === "23514"); databaseDenials++;
    } finally { await client.query("ROLLBACK"); client.release(); }
  }
  const freezing = await pool.connect(); await freezing.query("BEGIN");
  try {
    const root = { ...original.record,flowId: randomUUID() }; await insert(root,undefined,freezing);
    const accepted = nextStage(root,{ ...intake,flowId: root.flowId,expectedRecordSha256: createHash("sha256").update(JSON.stringify(root)).digest("hex") },Date.now());
    await insert(accepted,undefined,freezing);
    const frozen = nextStage(accepted,{ ...freeze,flowId: root.flowId,expectedSequence: accepted.sequence,
      expectedRecordSha256: createHash("sha256").update(JSON.stringify(accepted)).digest("hex"),referenceSha256: "0".repeat(64),frozenManifestSha256: "0".repeat(64) },Date.now());
    await assert.rejects(insert(frozen,undefined,freezing),(e: { code?: string }) => e.code === "23514"); databaseDenials++;
  } finally { await freezing.query("ROLLBACK"); freezing.release(); }
  // Terminal chains cannot be resumed even with a correctly linked new record.
  for (const v of [full,noRepro,unknown,cancelled,expired]) {
    const r = { ...v.record,sequence: v.record.sequence+1,previousSha256: v.recordSha256,kind: "INTAKE" as const,outcome: "ALLOWED" as const,state: "INTAKE_ACCEPTED" as const };
    await assert.rejects(insert(r),(e: { code?: string }) => e.code === "23514"); databaseDenials++;
  }
  await assert.rejects(insert({ ...candidate,flowId: randomUUID(),sequence: 0,kind: "OPEN",state: "OPEN",outcome: "NONE",previousSha256: "0".repeat(64),referenceSha256: requestHash },"0".repeat(64)),(e: { code?: string }) => e.code === "23514"); databaseDenials++;

  let privilegeDenials = 0, ownerImmutabilityDenials = 0;
  for (const sql of ['SELECT * FROM "user"','SELECT * FROM "Run"','SELECT * FROM "VerificationReport"','SELECT * FROM "_prisma_migrations"',
    'SELECT * FROM "ExecutionJob"','SELECT * FROM "ExecutionEffect"','SELECT * FROM "ExecutionReconciliation"','SELECT * FROM "MetaAttemptAccounting"',
    'SELECT "payload" FROM "FrozenPreparationPackage"','INSERT INTO "FrozenPreparationPackage" ("id") VALUES (gen_random_uuid())',
    'UPDATE "ExecutionStageJournal" SET "state"=\'OPEN\' WHERE false','DELETE FROM "ExecutionStageJournal" WHERE false','TRUNCATE "ExecutionStageJournal"']) {
    await assert.rejects(pool.query(sql),(e: { code?: string }) => e.code === "42501"); privilegeDenials++;
  }
  for (const sql of ['UPDATE "ExecutionStageJournal" SET "state"="state" WHERE "flowId"=$1','DELETE FROM "ExecutionStageJournal" WHERE "flowId"=$1']) {
    await assert.rejects(admin.query(sql,[original.record.flowId]),(e: { code?: string }) => e.code === "55000"); ownerImmutabilityDenials++;
  }
  await assert.rejects(admin.query('TRUNCATE "ExecutionStageJournal"'),(e: { code?: string }) => e.code === "55000"); ownerImmutabilityDenials++;
  assert.deepEqual((await admin.query('SELECT "id","state","version","cancelRequested" FROM "ExecutionJob" ORDER BY "id"')).rows,controlsBefore);
  const product = (await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports')).rows[0]; assert.deepEqual(product,{ runs: 0,reports: 0 });
  console.log(JSON.stringify({ result: "PASS",concurrentClients: 8,committedLostAckRecovered: true,databaseDenials,privilegeDenials,ownerImmutabilityDenials,
    retainedEarlierFlows: earlier.length,retainedImmutableSyntheticFlows: flowIds,retainedRecords: (await admin.query('SELECT count(*)::int n FROM "ExecutionStageJournal" WHERE "flowId"=ANY($1::uuid[])',[flowIds])).rows[0].n,
    noReproPatchStages: 0,oldQuarantinedControlUnchanged: true,actualProviderCalls: 0,productionVerdict: "INCONCLUSIVE",...product }));
} finally { await Promise.all([pool.end(),admin.end()]); }
