import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "35440" || url.pathname !== "/rpf012s_disposable") throw new Error("Refusing non-disposable database target");
const { prisma } = await import("../src/lib/prisma");
const { default: app } = await import("../src/app");
const { requestDraftResponseSchema } = await import("../src/contracts/requestDraft");
const origin = "http://localhost:3000";
const server = app.listen(0, "127.0.0.1");
const createdUsers: string[] = [];
const draftCount = () => prisma.requestDraft.count({ where: { userId: { in: createdUsers } } });
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
try {
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signup = async () => {
    const response = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Synthetic", email: `draft-${randomUUID()}@example.test`, password: "synthetic-password-123" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.user.id, "string"); createdUsers.push(body.user.id);
    const cookie = response.headers.getSetCookie().find(c => c.startsWith("better-auth.session_token="));
    assert.ok(cookie); return cookie.split(";")[0]!;
  };
  const a = await signup(), b = await signup();
  const endpoint = `${base}/api/v1/request-draft`;
  const draft = { repositoryId: "repoproof-backend", fixtureKey: "discount-bug", issueNumber: 1 };
  const get = (cookie?: string) => fetch(endpoint, { headers: cookie ? { cookie, origin } : {} });
  const put = (cookie: string, body: unknown, withOrigin = true) => fetch(endpoint, { method: "PUT", headers: { cookie, ...(withOrigin ? { origin } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await get()).status, 401);
  assert.deepEqual(requestDraftResponseSchema.parse(await (await get(a)).json()), { draft: null });
  assert.equal((await put(a, draft, false)).status, 403);
  assert.equal((await put(a, { ...draft, userId: "other" })).status, 400);
  assert.equal((await put(a, { ...draft, issueNumber: 2147483648 })).status, 400);
  assert.equal((await put(a, { ...draft, fixtureKey: "unauthorized" })).status, 404);
  assert.deepEqual(requestDraftResponseSchema.parse(await (await put(a, draft)).json()), { draft });
  assert.deepEqual(requestDraftResponseSchema.parse(await (await get(b)).json()), { draft: null });
  assert.deepEqual(requestDraftResponseSchema.parse(await (await get(a)).json()), { draft });
  assert.equal((await put(a, draft)).status, 200);
  assert.equal(await draftCount(), 1);
  assert.equal((await put(b, draft)).status, 200);
  assert.equal(await draftCount(), 2);
  const deleted = await fetch(endpoint, { method: "DELETE", headers: { cookie: a, origin } });
  assert.equal(deleted.status, 200);
  assert.deepEqual(requestDraftResponseSchema.parse(await deleted.json()), { draft: null });
  assert.deepEqual(requestDraftResponseSchema.parse(await (await get(a)).json()), { draft: null });
  assert.deepEqual(requestDraftResponseSchema.parse(await (await get(b)).json()), { draft });
  const remaining = await prisma.requestDraft.findUniqueOrThrow({ where: { userId: createdUsers[1]! } });
  const unused = { id: createdUsers[0]! };
  await assert.rejects(prisma.$executeRaw`INSERT INTO "RequestDraft" ("userId", "repositoryId", "fixtureKey", "issueNumber") VALUES (${unused.id}, ${"../escape"}, ${"discount-bug"}, ${1})`);
  await assert.rejects(prisma.$executeRaw`INSERT INTO "RequestDraft" ("userId", "repositoryId", "fixtureKey", "issueNumber") VALUES (${unused.id}, ${"repoproof-backend"}, ${"discount-bug"}, ${0})`);
  await assert.rejects(prisma.$executeRaw`INSERT INTO "RequestDraft" ("userId", "repositoryId", "fixtureKey", "issueNumber") VALUES (${"missing-user"}, ${"repoproof-backend"}, ${"discount-bug"}, ${1})`);
  assert.equal(await draftCount(), 1);
  await prisma.user.delete({ where: { id: remaining.userId } });
  assert.equal(await draftCount(), 0);
  const counts = await Promise.all([prisma.run.count(), prisma.issueSnapshot.count(), prisma.runApproval.count(), prisma.runEvent.count(), prisma.verificationReport.count()]);
  assert.deepEqual(counts, [0, 0, 0, 0, 0]);
  console.log("PASS: two-user PostgreSQL draft isolation, CSRF, invalid inputs, allowlist, idempotent save/delete, database constraints/cascade and zero run/evidence records");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try { await prisma.user.deleteMany({ where: { id: { in: createdUsers } } }); }
  finally { await prisma.$disconnect(); }
}
