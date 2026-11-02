// Real local PostgreSQL/auth/API and two approved public GitHub metadata GETs.
// Never imports/evaluates repository/fixture source or calls a model/runner.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { issuePreviewSchema } from "../src/contracts/issuePreview";
import { authRateStorage } from "../src/lib/authRateLimit";
import { issuePreviewLimiter } from "../src/safeMvp/issueRate";

const database = new URL(process.env.DATABASE_URL ?? "");
if (database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.port !== "35440" ||
  database.pathname !== "/rpf_product_disposable" || database.username !== "rpf_product_runtime" ||
  process.env.RPF_OWNED_GITHUB_READ_CONFIRMED !== "1") throw new Error("Confirm the owned disposable limited-role DB and two public GitHub metadata reads");
assert.equal(process.version,"v24.22.2");
const nativeFetch = globalThis.fetch, upstream: string[] = [], users: string[] = [];
const allowed = ["https://api.github.com/repos/asapial/repoproof_backend/git/commits/1066351c5b07bed024775a16af9151048a9316b2",
  "https://api.github.com/repos/asapial/repoproof_backend/issues/1"];
globalThis.fetch = async (input,init) => {
  const url = new URL(String(input));
  if (url.hostname !== "127.0.0.1") {
    assert.ok(allowed.includes(url.href)); assert.equal(init?.method,"GET");
    assert.equal(init?.credentials,"omit"); assert.equal(new Headers(init?.headers).has("authorization"),false);
    upstream.push(url.href); assert.ok(upstream.length <= 2);
  }
  return nativeFetch(input,init);
};
const { prisma } = await import("../src/lib/prisma");
const bundled = process.env.RPF_ISSUE_USE_BUNDLE === "1";
const { default: app }: typeof import("../src/app") = bundled ? await import(new URL("../function-build/app.js",import.meta.url).href) : await import("../src/app");
// Independent local observer. The app role must not read or write run/evidence
// tables merely so an integration test can inspect their unchanged row counts.
const observer = new pg.Pool({ connectionString: "postgresql://rpf_test@127.0.0.1:35440/rpf_product_disposable", max: 1 });
const server = app.listen(0,"127.0.0.1");
await new Promise<void>((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
try {
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, origin = "http://localhost:3000";
  const counts = async () => (await observer.query('SELECT (SELECT count(*)::int FROM "Run") AS runs, (SELECT count(*)::int FROM "VerificationReport") AS reports, (SELECT count(*)::int FROM "Artifact") AS artifacts')).rows[0];
  await assert.rejects(prisma.run.count());
  assert.equal((await prisma.$queryRaw<{ rolsuper: boolean }[]>`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)[0]?.rolsuper,false);
  const before = await counts(), endpoint = base+"/api/v1/repositories/repoproof-backend/issues";
  assert.equal((await fetch(endpoint)).status,401); assert.equal(upstream.length,0);
  const signup = async () => {
    const response = await fetch(base+"/api/auth/sign-up/email",{ method: "POST",headers: { origin,"content-type": "application/json" },
      body: JSON.stringify({ name: "Synthetic issue-preview user",email: `issue-${randomUUID()}@example.test`,password: "synthetic-password-123" }) });
    assert.equal(response.status,200); const body = await response.json(); users.push(body.user.id);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token=")); assert.ok(cookie); return cookie.split(";")[0]!;
  };
  const a = await signup(), b = await signup();
  const get = (cookie: string,path = endpoint) => fetch(path,{ headers: { cookie,origin } });
  assert.equal((await get(a,endpoint+"?url=https://evil.invalid")).status,400);
  assert.equal((await get(b,endpoint.replace("repoproof-backend","other"))).status,404);
  assert.equal((await fetch(endpoint,{ headers: { cookie: a,origin: "https://evil.invalid" } })).status,403);
  assert.equal(upstream.length,0);
  const response = await get(a); assert.equal(response.status,200); assert.equal(response.headers.get("cache-control"),"no-store");
  const preview = issuePreviewSchema.parse(await response.json()); assert.deepEqual(upstream,allowed);
  assert.deepEqual(await counts(),before);
  // Independently exercise actual atomic SQL admission with distinct test HMAC
  // namespaces, without dispatching another GitHub request or clearing quotas.
  const admit = issuePreviewLimiter(authRateStorage(prisma,"synthetic-issue-race-"+randomUUID()));
  const concurrent = await Promise.all(Array.from({ length: 8 },(_,i) => admit("synthetic-owner-"+i)));
  assert.equal(concurrent.filter(Boolean).length,5);
  const perOwner = issuePreviewLimiter(authRateStorage(prisma,"synthetic-issue-owner-"+randomUUID()));
  assert.deepEqual(await Promise.all([perOwner("owner-a"),perOwner("owner-a"),perOwner("owner-a")]).then(values => values.sort()),[false,true,true]);
  assert.equal(await perOwner("owner-b"),true);
  const run = await fetch(base+"/api/v1/runs",{ method: "POST",headers: { cookie: b,origin,"content-type": "application/json" },
    body: JSON.stringify({ repositoryId: preview.repositoryId,fixtureKey: preview.fixtureKey,issueNumber: 1 }) });
  assert.equal(run.status,503); assert.equal((await run.json()).error.code,"RUNNER_UNAVAILABLE"); assert.deepEqual(await counts(),before);
  console.log(JSON.stringify({ result: "PASS",scope: "LOCAL_POSTGRES_AUTH_API_AND_LIVE_PUBLIC_GITHUB_METADATA",upstreamGets: upstream.length,
    backendMode: bundled ? "EXPORTED_FUNCTION_BUNDLE" : "SOURCE",
    issueBodySha256: createHash("sha256").update(preview.issues[0]!.body).digest("hex"),baseSha: preview.baseSha,
    concurrentAdmissions: concurrent.filter(Boolean).length,concurrentAttempts: concurrent.length,productRowsUnchanged: true,limitedRuntimeRole: true,
    fixtureCodeExecutions: 0,modelCalls: 0,sandboxCalls: 0 }));
} finally {
  globalThis.fetch = nativeFetch;
  for (const id of users) await prisma.user.deleteMany({ where: { id } });
  server.closeAllConnections(); await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  await prisma.$disconnect();
  await observer.end();
}
