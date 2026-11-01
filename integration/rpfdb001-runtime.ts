import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { AddressInfo } from "node:net";

const runtime = new URL(process.env.DATABASE_URL ?? ""), observer = new URL(process.env.RPF_TEST_ADMIN_DATABASE_URL ?? "");
for (const url of [runtime, observer]) if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "35440" || url.pathname !== "/rpf012s_disposable") throw new Error("Refusing non-disposable role gate");
if (runtime.username !== "rpf_runtime_predeploy" || observer.username !== "rpf_test" || process.env.RPF_LOCAL_DB_GATE !== "1") throw new Error("Refusing unapproved runtime/observer identity");
const { prisma } = await import("../src/lib/prisma");
const { default: app } = await import("../src/app");
const admin = new Pool({ connectionString: observer.toString(), max: 1 });
const restricted = new Pool({ connectionString: runtime.toString(), max: 1 });
const users: string[] = [];
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
try {
  const identity = await restricted.query('SELECT current_user AS name, has_schema_privilege(current_user, \'public\', \'CREATE\') AS can_create');
  assert.equal(identity.rows[0].name, "rpf_runtime_predeploy"); assert.equal(identity.rows[0].can_create, false);
  for (const sql of ['CREATE TABLE public.rpf_should_not_exist(id int)', 'SELECT * FROM public."_prisma_migrations"', 'SELECT * FROM public."Run"', 'INSERT INTO public."Run" (id) VALUES (\'must-not-exist\')', 'SET ROLE rpf_test']) await assert.rejects(restricted.query(sql), { code: "42501" });
  const before = await admin.query('SELECT (SELECT count(*) FROM "Run") AS runs, (SELECT count(*) FROM "VerificationReport") AS reports');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, origin = "http://localhost:3000";
  const signup = async () => {
    const response = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Synthetic role", email: `role-${randomUUID()}@example.test`, password: "synthetic-password-123" }) });
    assert.equal(response.status, 200); const data = await response.json(); users.push(data.user.id);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token=")); assert.ok(cookie); return cookie.split(";")[0]!;
  };
  const a = await signup(), b = await signup();
  const endpoint = `${base}/api/v1/request-draft`, draft = { repositoryId: "repoproof-backend", fixtureKey: "discount-bug", issueNumber: 1 };
  const get = (cookie: string) => fetch(endpoint, { headers: { origin, cookie } });
  const headers = { origin, cookie: a, "content-type": "application/json" };
  assert.equal((await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify(draft) })).status, 200);
  assert.deepEqual(await (await get(a)).json(), { draft }); assert.deepEqual(await (await get(b)).json(), { draft: null });
  assert.equal((await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify({ ...draft, userId: users[1] }) })).status, 400);
  assert.equal((await fetch(endpoint, { method: "DELETE", headers: { origin, cookie: b } })).status, 200);
  assert.deepEqual(await (await get(a)).json(), { draft });
  await assert.rejects(restricted.query('UPDATE "RequestDraft" SET "issueNumber" = 0 WHERE "userId" = $1', [users[0]]), { code: "23514" });
  const run = await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify(draft) }); assert.equal(run.status, 503); assert.equal((await run.json()).error.code, "RUNNER_UNAVAILABLE");
  assert.deepEqual((await admin.query('SELECT (SELECT count(*) FROM "Run") AS runs, (SELECT count(*) FROM "VerificationReport") AS reports')).rows, before.rows);
  await restricted.end();
  const [{ pid }] = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  assert.ok(pid); assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows[0].terminated, true);
  await new Promise(resolve => setTimeout(resolve, 100));
  const recovered = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  assert.notEqual(recovered[0]?.pid, pid);
  assert.deepEqual(await (await get(a)).json(), { draft });
  console.log("PASS: limited runtime cannot migrate/read evidence/assume owner; real two-user auth/draft isolation, constraints, zero runs and terminated-connection recovery");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try { await admin.query('DELETE FROM public."user" WHERE id = ANY($1::text[])', [users]); }
  finally { await prisma.$disconnect(); if (!restricted.ended) await restricted.end(); await admin.end(); }
}
