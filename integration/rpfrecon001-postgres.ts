// Trusted control-plane SQL and synthetic signed observations. No fixture/provider execution.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { PostgresExecutionJobs, type JobResult } from "../src/execution/jobs";
import { assessReconciliation, encodeReconciliation, reconciliationSigningBytes, type AcceptedReconciliation,
  type ReconciliationContext, type ReconciliationObservation, type ReconciliationTrustKey } from "../src/execution/reconciliation";
import { PostgresReconciliations } from "../src/execution/reconciliationStore";
import { databasePoolOptions } from "../src/lib/databasePool";

const observerUrl = new URL(process.env.RPF_RECON_DATABASE_URL ?? ""), jobUrl = new URL(process.env.DATABASE_URL ?? ""), adminUrl = new URL(process.env.RPF_JOB_ADMIN_URL ?? "");
for (const url of [observerUrl, jobUrl, adminUrl]) if (url.hostname !== "127.0.0.1" || url.port !== "35440" || url.pathname !== "/rpf_engine_disposable" || url.password) throw new Error("Owned disposable reconciliation database required");
if (observerUrl.username !== "rpf_engine_reconciliation" || jobUrl.username !== "rpf_engine_jobs" || adminUrl.username !== "rpf_test" || process.env.RPF_RECON_GATE !== "1") throw new Error("Limited disposable identities required");
const observer = new Pool({ ...databasePoolOptions(observerUrl.toString()), max: 2 }); observer.on("error", () => {});
const worker = new Pool({ ...databasePoolOptions(jobUrl.toString()), max: 2 }); worker.on("error", () => {});
const admin = new Pool({ ...databasePoolOptions(adminUrl.toString()), max: 1 });
function traced(pool: Pool) {
  return { connect: async () => {
    const client = await pool.connect();
    return { query: async (text: string, values?: unknown[]) => {
      try { return await client.query(text, values); } catch (error) {
        const code = (error as { code?: unknown }).code;
        console.error(JSON.stringify({ syntheticSqlGateFailure: true, statement: text.trim().split(/\s/)[0], code: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "UNKNOWN" }));
        throw error;
      }
    }, release: (destroy?: boolean) => client.release(destroy) } as PoolClient;
  } };
}
const store = new PostgresReconciliations(traced(observer)), jobs = new PostgresExecutionJobs(worker), ids: string[] = [];
const value = <T>(result: JobResult<T>): T => { assert.equal(result.ok, true, "store available"); if (!result.ok) throw new Error("Store unavailable"); return result.value; };
const ownerId = `recon-${randomUUID()}`, pair = generateKeyPairSync("ed25519");
const key: ReconciliationTrustKey = { keyId: "synthetic-independent-observer", purpose: "reconciliation-observer",
  publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), liveIdentityApproved: false };
function signed(context: ReconciliationContext, overrides: Partial<Omit<ReconciliationObservation, "signature" | "context">> = {}): { raw: ReconciliationObservation; handle: AcceptedReconciliation } {
  const now = Date.now();
  const unsigned: Omit<ReconciliationObservation, "signature"> = { version: "rpf-reconciliation-v1", evidenceId: randomUUID(), context,
    source: "OFFLINE_SYNTHETIC", keyId: key.keyId, observedAtMs: now, expiresAtMs: now + 60000,
    observedState: "STOPPED", providerIdentitySha256: "b".repeat(64), cleanupConfirmed: context.kind === "SANDBOX", noChargeConfirmed: false,
    factsSha256: createHash("sha256").update(randomUUID()).digest("hex"), ...overrides };
  const raw = { ...unsigned, signature: sign(null, reconciliationSigningBytes(unsigned), pair.privateKey).toString("hex") };
  const result = assessReconciliation(encodeReconciliation(raw), [key], { context, source: "OFFLINE_SYNTHETIC", dispatcherFingerprint: "d".repeat(64) }, Date.now());
  assert.equal(result.ok, true); if (!result.ok) throw new Error("Synthetic signature validation");
  return { raw, handle: result.value };
}
async function create(kind: "META" | "SANDBOX", ttl = 20000) {
  const id = randomUUID(); ids.push(id);
  value(await jobs.submit({ id, ownerId, idempotencyKey: randomUUID(), requestHash: "a".repeat(64), deadlineAtMs: Date.now() + ttl }));
  const lease = value(await jobs.claim()); assert.ok(lease);
  const effectId = randomUUID(); assert.equal(value(await jobs.recordPossibleEffect(lease, { id: effectId, kind, requestHash: "c".repeat(64) })), true);
  const context = value(await store.context(id, effectId)); assert.ok(context);
  return { id, effectId, context };
}
try {
  const before = (await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports')).rows[0];
  assert.equal((await admin.query('SELECT count(*)::int count FROM "ExecutionJob"')).rows[0].count, 0, "exclusive synthetic database required");
  const first = await create("SANDBOX", 2000), initial = signed(first.context);
  const contenders = Array.from({ length: 8 }, () => new Pool({ ...databasePoolOptions(observerUrl.toString()), max: 1 }));
  try {
    const results = await Promise.all(contenders.map(pool => new PostgresReconciliations(traced(pool)).append(initial.handle)));
    for (const result of results) assert.equal(value(result), true, "same-key concurrent acknowledgement is idempotent");
  } finally { await Promise.all(contenders.map(pool => pool.end())); }
  assert.equal((await observer.query('SELECT count(*)::int count FROM "ExecutionReconciliation" WHERE "effectId"=$1', [first.effectId])).rows[0].count, 1);
  assert.equal(value(await jobs.claim()), null, "reconciliation cannot release quarantine for dispatch");
  const reread = value(await new PostgresReconciliations(observer).load(initial.raw.evidenceId)); assert.ok(reread);
  assert.equal(reread.authentic, false); assert.equal(reread.payloadSha256, initial.handle.payloadSha256);
  assert.deepEqual(reread.bytes, encodeReconciliation(initial.raw), "restart retrieval preserves complete signed payload");
  assert.equal(assessReconciliation(reread.bytes, [key], { context: first.context, source: "OFFLINE_SYNTHETIC", dispatcherFingerprint: "d".repeat(64) }, Date.now()).ok, true);
  assert.equal(value(await store.append(signed(first.context, { evidenceId: initial.raw.evidenceId }).handle)), false, "same ID with changed evidence rejected");
  assert.equal(value(await store.append(signed(first.context, { observedAtMs: initial.raw.observedAtMs, factsSha256: initial.raw.factsSha256 }).handle)), false, "same observation cannot gain a fresh evidence identity");

  const lost = signed(first.context, { observedState: "UNKNOWN", providerIdentitySha256: null, cleanupConfirmed: false });
  const lostAckPool = { connect: async () => {
    const client = await observer.connect();
    return { query: async (text: string, values?: unknown[]) => {
      const result = await client.query(text, values); if (text === "COMMIT") throw new Error("Synthetic lost committed acknowledgement"); return result;
    }, release: (destroy?: boolean) => client.release(destroy) } as PoolClient;
  } };
  assert.deepEqual(await new PostgresReconciliations(lostAckPool).append(lost.handle), { ok: false, reason: "UNAVAILABLE" });
  assert.ok(value(await store.load(lost.raw.evidenceId)), "real committed SQL survives a lost acknowledgement");
  assert.equal(value(await store.append(lost.handle)), true, "retry retains original identity without another observation/effect");

  value(await jobs.cancel({ ownerId, id: first.id }));
  const current = value(await store.context(first.id, first.effectId)); assert.ok(current); assert.equal(current.cancelRequested, true);
  assert.equal(value(await store.append(signed(first.context).handle)), false, "stale version/cancellation evidence cannot append");
  assert.equal(value(await store.append(signed(current, { observedState: "NOT_FOUND", providerIdentitySha256: null, cleanupConfirmed: false }).handle)), true);
  const remainingMs = Math.max(0, current.deadlineAtMs - Date.now() + 30);
  if (remainingMs) await admin.query('SELECT pg_sleep($1)', [remainingMs / 1000]);
  value(await jobs.recover());
  assert.equal(value(await jobs.get({ ownerId, id: first.id }))?.state, "QUARANTINED", "expiry/cancel/NOT_FOUND do not release an uncertain external effect");
  assert.equal(value(await jobs.claim()), null);
  assert.equal((await observer.query('SELECT count(*)::int count FROM "ExecutionEffect" WHERE "jobId"=$1', [first.id])).rows[0].count, 1);

  let denials = 0;
  for (const sql of ['UPDATE "ExecutionReconciliation" SET "keyId"=\'bad\' WHERE false', 'DELETE FROM "ExecutionReconciliation" WHERE false',
    'TRUNCATE "ExecutionReconciliation"', 'UPDATE "ExecutionJob" SET "state"=\'QUEUED\' WHERE false', 'DELETE FROM "ExecutionEffect" WHERE false',
    'INSERT INTO "ExecutionEffect" ("id","jobId","kind","requestHash") VALUES (gen_random_uuid(),gen_random_uuid(),\'META\',repeat(\'a\',64))',
    'SELECT * FROM "user"', 'SELECT * FROM "Run"', 'SELECT * FROM "_prisma_migrations"']) {
    await assert.rejects(observer.query(sql), (error: { code?: string }) => error.code === "42501"); denials++;
  }
  await assert.rejects(worker.query('SELECT * FROM "ExecutionReconciliation"'), (error: { code?: string }) => error.code === "42501"); denials++;
  for (const patch of [{ jobId: randomUUID() }, { effectId: randomUUID() }, { jobVersion: current.jobVersion + 99 }, { requestHash: "0".repeat(64) },
    { deadlineAtMs: current.deadlineAtMs - 1 },
    { cancelRequested: false, jobVersion: current.jobVersion }, { observedAtMs: 0, jobVersion: current.jobVersion },
    { observedAtMs: Date.now() + 3600000, expiresAtMs: Date.now() + 3601000, jobVersion: current.jobVersion },
    { expiresAtMs: 1, jobVersion: current.jobVersion }]) {
    const overrides = { jobVersion: current.jobVersion, cancelRequested: current.cancelRequested, deadlineAtMs: current.deadlineAtMs,
      evidenceId: randomUUID(), payloadSha256: createHash("sha256").update(randomUUID()).digest("hex"), factsSha256: createHash("sha256").update(randomUUID()).digest("hex"), ...patch };
    await assert.rejects(observer.query(`INSERT INTO "ExecutionReconciliation"
      SELECT (jsonb_populate_record(NULL::"ExecutionReconciliation",to_jsonb(r)||$2::jsonb)).* FROM "ExecutionReconciliation" r WHERE "evidenceId"=$1`,
    [initial.raw.evidenceId, JSON.stringify(overrides)]), (error: { code?: string }) => error.code === "23514" || error.code === "23503");
  }
  const after = (await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports')).rows[0];
  assert.deepEqual(after, before); assert.deepEqual(before, { runs: 0, reports: 0 });
  console.log(JSON.stringify({ result: "PASS", observations: 3, concurrentClients: 8, privilegeDenials: denials,
    databaseGuardDenials: 9, lostAcknowledgement: "genuinely committed SQL; synthetic acknowledgement loss", quarantineReleased: false,
    providerDispatches: 0, runs: after.runs, reports: after.reports }));
} finally {
  // Only this script's synthetic IDs in the explicitly owned local test database.
  if (ids.length) {
    await admin.query('DELETE FROM "ExecutionReconciliation" WHERE "jobId"=ANY($1::uuid[])', [ids]);
    await admin.query('DELETE FROM "ExecutionEffect" WHERE "jobId"=ANY($1::uuid[])', [ids]);
    await admin.query('DELETE FROM "ExecutionJob" WHERE "id"=ANY($1::uuid[])', [ids]);
  }
  await Promise.all([observer.end(), worker.end(), admin.end()]);
}
