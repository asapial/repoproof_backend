// Real PostgreSQL control tests only. Never calls the provider or runs fixtures.
import assert from "node:assert/strict";
import { Client } from "pg";
import { PostgresSmokeControl } from "../src/sandbox/control";
import type { SmokeConfig } from "../src/sandbox/policy";

const url = process.env.DATABASE_URL;
if (process.env.RPF_LOCAL_DB_GATE !== "1" || !url) throw new Error("Disposable database required");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.port !== "35440" || parsed.pathname !== "/rpf012s_disposable" || parsed.username !== "rpf_test") throw new Error("Disposable database required");
const client = new Client({ connectionString: url });
const control = new PostgresSmokeControl(url);
const config: SmokeConfig = { enabled: true, adminId: "synthetic-admin", projectId: "prj_test", teamId: "team_test", token: "unused", image: `registry.vercel.com/owned/node@sha256:${"a".repeat(64)}`, nodeVersion: "v24.22.2", databaseUrl: url };
await client.connect();
try {
  const empty = await client.query("SELECT count(*)::int count FROM sandbox_control.smoke");
  assert.equal(empty.rows[0].count, 0, "Refuse to overwrite an existing control row");
  assert.equal(await control.claim(config, config.adminId), false);
  await client.query(`INSERT INTO sandbox_control.smoke (singleton,state,admin_id,project_id,team_id,image,node_version,plan,checked_at,expires_at,cpu_seconds_remaining,memory_gib_seconds_remaining,creations_remaining,transfer_bytes_remaining)
    VALUES (1,'APPROVED',$1,$2,$3,$4,$5,'HOBBY',clock_timestamp(),clock_timestamp()+interval '4 minutes',0,120,2,2097152)`, [config.adminId,config.projectId,config.teamId,config.image,config.nodeVersion]);
  assert.equal(await control.claim(config, config.adminId), false, "zero quota denies");
  await client.query("UPDATE sandbox_control.smoke SET cpu_seconds_remaining=60, checked_at=clock_timestamp()-interval '10 minutes', expires_at=clock_timestamp()-interval '6 minutes'");
  assert.equal(await control.claim(config, config.adminId), false, "stale quota denies");
  await client.query("UPDATE sandbox_control.smoke SET checked_at=clock_timestamp(), expires_at=clock_timestamp()+interval '4 minutes'");
  assert.equal(await control.claim(config, "ordinary-user"), false, "wrong admin denies");
  assert.equal(await control.claim({ ...config, projectId: "prj_other" }, config.adminId), false, "wrong project denies");
  // Eight actual independent clients contend for the same single shared row.
  const contenders = Array.from({ length: 8 }, () => new PostgresSmokeControl(url));
  try { assert.equal((await Promise.all(contenders.map(item => item.claim(config, config.adminId)))).filter(Boolean).length, 1); }
  finally { await Promise.all(contenders.map(item => item.close())); }
  assert.equal(await control.claim(config, config.adminId), false, "consumed permit stays closed");
  await control.finish(false); await control.finish(true);
  await assert.rejects(client.query("UPDATE sandbox_control.smoke SET state='APPROVED'"), /Smoke permission is consumed/);
  const final = await client.query("SELECT state,cleanup_confirmed FROM sandbox_control.smoke");
  assert.deepEqual(final.rows, [{ state: "CONSUMED", cleanup_confirmed: true }]);
  console.log("PASS: actual PostgreSQL missing/zero/stale quota, admin/project isolation, 8-client one-shot concurrency, durable replay and no-rearm. No provider calls.");
} finally { await control.close(); await client.end(); }
