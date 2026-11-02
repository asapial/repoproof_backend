// Synthetic database records only. Stored states are not execution/verdict proof.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { runHistoryResponseSchema } from "../src/contracts/runHistory";
import { encodeHistoryCursor } from "../src/safeMvp/historyStore";
import { fixturePin } from "../src/sandbox/fixture";

const target = new URL(process.env.DATABASE_URL ?? ""), origin = "http://localhost:3000";
if (process.version !== "v24.22.2" || target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" || target.port !== "35440" ||
  target.pathname !== "/rpf_history_disposable" || target.username !== "rpf_history_runtime" || process.env.RPF_LOCAL_HISTORY_GATE !== "1") throw new Error("Refusing non-disposable history gate");
const nativeFetch = globalThis.fetch; let externalAttempts = 0;
globalThis.fetch = async (input, init) => {
  if (new URL(String(input)).hostname !== "127.0.0.1") { externalAttempts++; throw new Error("External network denied by history gate"); }
  return nativeFetch(input, init);
};
const { prisma } = await import("../src/lib/prisma"), bundled = process.env.RPF_HISTORY_USE_BUNDLE === "1";
const { default: app }: typeof import("../src/app") = bundled ? await import(new URL("../function-build/app.js", import.meta.url).href) : await import("../src/app");
const admin = new pg.Pool({ connectionString: "postgresql://rpf_test@127.0.0.1:35440/rpf_history_disposable", max: 1 });
const runtime = new pg.Pool({ connectionString: target.toString(), max: 1 });
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
try {
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, url = base + "/api/v1/runs";
  const signup = async () => {
    const response = await fetch(base + "/api/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name: "Synthetic history test", email: `history-${randomUUID()}@example.test`, password: "synthetic-password-123" }) });
    assert.equal(response.status, 200); const data = await response.json();
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token="))?.split(";")[0]; assert.ok(cookie);
    return { id: data.user.id as string, cookie };
  };
  const a = await signup(), b = await signup(), empty = await signup();
  const get = (cookie: string, query = "") => fetch(url + query, { headers: { cookie } });
  assert.equal((await fetch(url)).status, 401);
  assert.equal(runHistoryResponseSchema.parse(await (await get(a.cookie)).json()).summary.total, 0);
  const suffix = randomUUID(), repositoryId = "history-approved";
  await admin.query('INSERT INTO public."Repository" (id,"githubRepoId",owner,name,"fullName","defaultBranch","fixtureKey","mvpAllowed","updatedAt") VALUES ($1,1,\'asapial\',\'repoproof_backend\',\'asapial/repoproof_backend\',\'main\',\'discount-bug\',true,now()) ON CONFLICT (id) DO NOTHING', [repositoryId]);
  const hiddenRepo = `hidden-${suffix}`;
  await admin.query('INSERT INTO public."Repository" (id,"githubRepoId",owner,name,"fullName","defaultBranch","fixtureKey","mvpAllowed","updatedAt") VALUES ($1,$2,\'private\',\'hidden\',$1,\'main\',$1,false,now())', [hiddenRepo, String(Date.now())]);
  const seed = async (owner: string | null, state: string, index: string, title: string, repo = repositoryId, pin = fixturePin) => {
    const issue = `issue-${suffix}-${index}`, id = `run-${suffix}-${index}`;
    await admin.query('INSERT INTO public."IssueSnapshot" (id,"repositoryId",number,title,body,"issueUrl") VALUES ($1,$2,1,$3,\'PRIVATE-BODY-MUST-NOT-LEAK\',\'https://example.test/private\')', [issue, repo, title]);
    await admin.query('INSERT INTO public."Run" (id,"userId","repositoryId","issueSnapshotId","baseSha","fixtureKey",state,"createdAt","updatedAt","modelId","leaseOwner","planJson") VALUES ($1,$2,$3,$4,$5,$6,$7::"RunState",\'2026-11-02T12:00:00.000\',now(),\'PRIVATE-MODEL\',\'PRIVATE-LEASE\',\'{"private":"PRIVATE-PLAN"}\')', [id, owner, repo, issue, pin, repo === repositoryId ? "discount-bug" : hiddenRepo, state]);
    return id;
  };
  const own: string[] = [];
  for (const [index, state] of ["CREATED", "AWAITING_APPROVAL", "QUEUED", "COMPLETED", "FAILED", "CANCELLED", "BASELINING"].entries()) own.push(await seed(a.id, state, String(index), "Owned <script>untrusted title</script>"));
  const other = await seed(b.id, "COMPLETED", "b", "B-PRIVATE-TITLE");
  await seed(null, "COMPLETED", "null", "UNOWNED-PRIVATE-TITLE");
  await seed(a.id, "COMPLETED", "hidden", "HIDDEN-PRIVATE-TITLE", hiddenRepo);
  await seed(a.id, "COMPLETED", "wrongpin", "WRONG-PIN-PRIVATE-TITLE", repositoryId, "a".repeat(40));
  const beforeCounts = (await admin.query('SELECT (SELECT count(*) FROM public."Run") AS runs, (SELECT count(*) FROM public."VerificationReport") AS reports, (SELECT count(*) FROM public."Artifact") AS artifacts')).rows;
  const first = await get(a.cookie, "?limit=2"); assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "no-store");
  const firstPage = runHistoryResponseSchema.parse(await first.json());
  assert.deepEqual(firstPage.summary, { total: 7, running: 3, awaitingApproval: 1, completed: 1, failed: 1, cancelled: 1, repositories: 1, submittedIssues: 1 });
  const seen = firstPage.runs.map(run => run.id); let cursor = firstPage.nextCursor;
  while (cursor) { const page = runHistoryResponseSchema.parse(await (await get(a.cookie, "?limit=2&cursor=" + cursor)).json()); seen.push(...page.runs.map(run => run.id)); cursor = page.nextCursor; }
  assert.deepEqual(seen, own.sort().reverse());
  assert.equal(runHistoryResponseSchema.parse(await (await get(b.cookie)).json()).summary.total, 1);
  assert.equal(runHistoryResponseSchema.parse(await (await get(empty.cookie)).json()).summary.total, 0);
  const forged = encodeHistoryCursor({ at: "2026-11-02T12:00:00.000Z", id: other });
  const forgedPage = runHistoryResponseSchema.parse(await (await get(a.cookie, "?cursor=" + forged)).json());
  assert.ok(forgedPage.runs.every(run => own.includes(run.id)));
  for (const query of ["?userId=" + b.id, "?limit=26", "?cursor=bad", "?limit=1&limit=2"]) assert.equal((await get(a.cookie, query)).status, 400);
  const json = JSON.stringify(firstPage); assert.ok(!/PRIVATE|planJson|leaseOwner|storageKey|verdict|modelId/.test(json));
  for (const query of ['SELECT * FROM public."Run"', 'SELECT * FROM public."Artifact"', 'SELECT * FROM public."VerificationReport"', 'UPDATE public."Run" SET state=\'COMPLETED\'', 'SET ROLE rpf_test']) await assert.rejects(runtime.query(query), { code: "42501" });
  await assert.rejects(runtime.query("SELECT public.repoproof_history_v1($1,NULL,NULL,26)", [a.id]), { code: "22023" });
  await assert.rejects(runtime.query("SELECT public.repoproof_history_v1($1,NULL,NULL,1)", ["' OR true --"]), { code: "22023" });
  const acl = (await admin.query("SELECT p.prosecdef, EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0) AS public_access FROM pg_proc p WHERE p.oid='public.repoproof_history_v1(text,timestamptz,text,integer)'::regprocedure")).rows[0];
  assert.equal(acl.prosecdef, true); assert.equal(acl.public_access, false);
  for (let index = 0; index < 60; index++) {
    const response = await get(empty.cookie); if (response.status === 429) { assert.equal(response.headers.get("retry-after"), "60"); break; }
    assert.equal(response.status, 200); assert.ok(index < 59, "Expected actual shared per-owner rate limit");
  }
  assert.equal((await fetch(url, { method: "POST", headers: { cookie: a.cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ repositoryId: "repoproof-backend", fixtureKey: "discount-bug", issueNumber: 1 }) })).status, 503);
  assert.deepEqual((await admin.query('SELECT (SELECT count(*) FROM public."Run") AS runs, (SELECT count(*) FROM public."VerificationReport") AS reports, (SELECT count(*) FROM public."Artifact") AS artifacts')).rows, beforeCounts);
  assert.equal(externalAttempts, 0);
  console.log(JSON.stringify({ result: "PASS", scope: "SYNTHETIC_RECORDS_REAL_POSTGRES_HTTP_HISTORY", mode: bundled ? "EXPORTED_FUNCTION" : "SOURCE", migrations: 11,
    ownRuns: 7, pagination: true, otherOwnerAndNullDenied: true, unsupportedFixturesHidden: true, rawEvidencePrivilegesDenied: true, actualSharedRateLimit: true,
    runCreationUnavailable: true, recordsUnchangedAfterSeed: true, externalAttempts, fixtureExecutions: 0, modelCalls: 0, sandboxCalls: 0 }));
} finally {
  globalThis.fetch = nativeFetch; server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await prisma.$disconnect(); await admin.end(); await runtime.end();
}
