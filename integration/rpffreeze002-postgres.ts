// Trusted SQL and immutable public fixture bytes as data. No generated/fixture execution.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { loadOwnedFixture, fixturePin } from "../src/sandbox/fixture";
import { freezeDiscountTest, readSnapshot, sha256 } from "../src/verification/frozen";
import { PostgresFrozenPackages, durableBaseline, generateDurableDiscountPatch } from "../src/execution/frozenPackages";
import { databasePoolOptions } from "../src/lib/databasePool";
import type { JobResult } from "../src/execution/jobs";

const packageUrl = new URL(process.env.RPF_PACKAGE_DATABASE_URL ?? ""), adminUrl = new URL(process.env.RPF_JOB_ADMIN_URL ?? "");
for (const url of [packageUrl, adminUrl]) if (url.hostname !== "127.0.0.1" || url.port !== "35440" || url.pathname !== "/rpf_engine_disposable" || url.password) throw new Error("Owned disposable package database required");
if (packageUrl.username !== "rpf_engine_packages" || adminUrl.username !== "rpf_test" || process.env.RPF_PACKAGE_GATE !== "1") throw new Error("Limited disposable package identities required");
const pool = new Pool({ ...databasePoolOptions(packageUrl.toString()), max: 2 }); pool.on("error", () => {});
const admin = new Pool({ ...databasePoolOptions(adminUrl.toString()), max: 1 }), store = new PostgresFrozenPackages(pool);
const value = <T>(result: JobResult<T>): T => { assert.equal(result.ok, true, "store available"); if (!result.ok) throw new Error("Store unavailable"); return result.value; };
const owned = await loadOwnedFixture(), original = owned.find(file => file.path === "src/discount.mjs")!;
function frozen(label: string) {
  return freezeDiscountTest(owned, Buffer.from(`import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { applyDiscount } from "../src/discount.mjs";\ntest("synthetic durable ${label}", () => { assert.equal(applyDiscount(100, 20), 80); });\n`));
}
const id = randomUUID(), lostId = randomUUID(), invalidId = randomUUID(), records = [id, lostId, invalidId];
try {
  const before = (await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports')).rows[0];
  const first = frozen(id), contenders = Array.from({ length: 8 }, () => new Pool({ ...databasePoolOptions(packageUrl.toString()), max: 1 }));
  try {
    const results = await Promise.all(contenders.map(client => new PostgresFrozenPackages(client).persist(id, first)));
    for (const result of results) assert.ok(value(result));
  } finally { await Promise.all(contenders.map(client => client.end())); }
  assert.equal((await admin.query('SELECT count(*)::int count FROM "FrozenPreparationPackage" WHERE "id"=$1', [id])).rows[0].count, 1);
  const loaded = value(await new PostgresFrozenPackages(pool).load(id)); assert.ok(loaded);
  assert.equal(loaded.manifestSha256, first.manifestSha256);
  assert.equal(loaded.purpose, "PREPARATION_ONLY");
  assert.equal(value(await store.persist(id, frozen(randomUUID()))), null, "same ID cannot overwrite frozen bytes");
  assert.equal(value(await store.persist(randomUUID(), first)), null, "original content identity cannot gain another row");
  const baseline = durableBaseline(loaded), source = { baseSha: fixturePin, issue: { number: 1, title: "Owned synthetic case", body: "Synthetic issue data" },
    files: [{ path: original.path, content: original.content.toString(), sha256: sha256(original.content) }] };
  let proposals = 0;
  const provider = { async generateSourcePatch() {
    // A different real PostgreSQL connection must see committed bytes before
    // this synthetic proposal capability can be called.
    assert.equal((await admin.query('SELECT count(*)::int count FROM "FrozenPreparationPackage" WHERE "id"=$1', [id])).rows[0].count, 1);
    proposals++;
    return { data: { baseSha: fixturePin, changes: [{ path: original.path, previousSha256: sha256(original.content),
      content: 'export function applyDiscount(price, percentage) { return price - (price * percentage) / 100; }' }], explanation: "Synthetic unexecuted patch" },
      metadata: { id: "synthetic", model: "synthetic", latencyMs: 0 } };
  } };
  await assert.rejects(generateDurableDiscountPatch(JSON.parse(JSON.stringify(loaded)), provider, source), /INVALID_DURABLE_FREEZE/);
  assert.equal(proposals, 0);
  const patched = await generateDurableDiscountPatch(loaded, provider, source); assert.equal(proposals, 1);
  assert.deepEqual(readSnapshot(baseline).filter(file => file.path.startsWith("tests/")), readSnapshot(patched).filter(file => file.path.startsWith("tests/")));

  const lostAckPool = { connect: async () => {
    const client = await pool.connect();
    return { query: async (text: string, values?: unknown[]) => {
      const result = await client.query(text, values); if (text === "COMMIT") throw new Error("Synthetic lost committed acknowledgement"); return result;
    }, release: (destroy?: boolean) => client.release(destroy) } as PoolClient;
  } };
  const second = frozen(lostId);
  assert.deepEqual(await new PostgresFrozenPackages(lostAckPool).persist(lostId, second), { ok: false, reason: "UNAVAILABLE" });
  const recovered = value(await new PostgresFrozenPackages(pool).load(lostId)); assert.ok(recovered);
  assert.equal(recovered.manifestSha256, second.manifestSha256, "committed bytes survive acknowledgement loss and store restart");
  assert.ok(value(await store.persist(lostId, second)), "same original ID recovers without duplicate data");

  let denials = 0;
  for (const sql of ['UPDATE public."FrozenPreparationPackage" SET "purpose"=\'bad\' WHERE false', 'DELETE FROM public."FrozenPreparationPackage" WHERE false',
    'TRUNCATE public."FrozenPreparationPackage"', 'SELECT * FROM public."ExecutionJob"', 'SELECT * FROM public."ExecutionReconciliation"',
    'SELECT * FROM public."Run"', 'SELECT * FROM public."user"', 'SELECT * FROM public."_prisma_migrations"']) {
    await assert.rejects(pool.query(sql), (error: { code?: string }) => error.code === "42501"); denials++;
  }
  await assert.rejects(admin.query('UPDATE public."FrozenPreparationPackage" SET "payload"="payload" WHERE "id"=$1', [id]), (error: { code?: string }) => error.code === "55000");
  await assert.rejects(admin.query('DELETE FROM public."FrozenPreparationPackage" WHERE "id"=$1', [id]), (error: { code?: string }) => error.code === "55000");
  await assert.rejects(admin.query('TRUNCATE public."FrozenPreparationPackage"'), (error: { code?: string }) => error.code === "55000");
  const malformed = Buffer.from('{"syntheticMalformed":"' + invalidId);
  await assert.rejects(pool.query('INSERT INTO public."FrozenPreparationPackage" ("id","manifestSha256","payloadSha256","payload") VALUES ($1,$2,$3,$4)',
    [randomUUID(), "e".repeat(64), "0".repeat(64), malformed]), (error: { code?: string }) => error.code === "23514");
  await pool.query('INSERT INTO public."FrozenPreparationPackage" ("id","manifestSha256","payloadSha256","payload") VALUES ($1,$2,$3,$4)',
    [invalidId, sha256(Buffer.from(invalidId)), sha256(malformed), malformed]);
  assert.deepEqual(await store.load(invalidId), { ok: false, reason: "UNAVAILABLE" }, "checksum alone cannot mint authority for malformed bytes");
  const count = (await admin.query('SELECT count(*)::int count FROM public."FrozenPreparationPackage" WHERE "id"=ANY($1::uuid[])', [records])).rows[0].count;
  assert.equal(count, 3);
  const after = (await admin.query('SELECT (SELECT count(*) FROM "Run")::int runs,(SELECT count(*) FROM "VerificationReport")::int reports')).rows[0];
  assert.deepEqual(after, before); assert.deepEqual(after, { runs: 0, reports: 0 });
  console.log(JSON.stringify({ result: "PASS", concurrentClients: 8, privilegeDenials: denials, ownerImmutabilityDenials: 3,
    databaseDigestDenials: 1, malformedReadDenied: true, proposalsAfterCommitOnly: true, actualProviderCalls: 0,
    retainedImmutableSyntheticRecordIds: records, retainedRecordsThisGate: count, runs: after.runs, reports: after.reports }));
} finally {
  // Immutable preparation test records remain in the owned disposable tmpfs DB.
  // Never disable triggers or grant deletion merely to clean a passing test.
  await Promise.all([pool.end(), admin.end()]);
}
