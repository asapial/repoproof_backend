import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

// Refuse every target except the dedicated local disposable integration database.
const url = new URL(process.env.DATABASE_URL ?? "");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "35440" || url.pathname !== "/rpf012s_disposable") throw new Error("Refusing non-disposable database target");
const { prisma } = await import("../src/lib/prisma");
const { default: app } = await import("../src/app");
const { errorResponseSchema } = await import("../src/contracts/v1");
const origin = "http://localhost:3000";
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
try {
  const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(identity[0]?.name, "rpf012s_disposable");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Synthetic", email: `safe-${randomUUID()}@example.test`, password: "synthetic-only-password-123" }) });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().find(c => c.startsWith("better-auth.session_token="))?.split(";")[0];
  assert.ok(cookie);
  const catalog = await fetch(`${base}/api/v1/repositories`, { headers: { origin, cookie } });
  assert.equal(catalog.status, 200);
  const items = await catalog.json() as { repositories: Array<{ repositoryId: string; fixtureKey: string; issueNumber: number; source: string }> };
  assert.equal(items.repositories.length, 1); assert.equal(items.repositories[0]?.source, "CURATED");
  const before = await Promise.all([prisma.run.count(), prisma.issueSnapshot.count(), prisma.runApproval.count(), prisma.runEvent.count(), prisma.verificationReport.count()]);
  const item = items.repositories[0]!;
  const body = JSON.stringify({ repositoryId: item.repositoryId, fixtureKey: item.fixtureKey, issueNumber: item.issueNumber });
  const unavailable = await fetch(`${base}/api/v1/runs`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body });
  assert.equal(unavailable.status, 503);
  assert.equal(errorResponseSchema.parse(await unavailable.json()).error.code, "RUNNER_UNAVAILABLE");
  const after = await Promise.all([prisma.run.count(), prisma.issueSnapshot.count(), prisma.runApproval.count(), prisma.runEvent.count(), prisma.verificationReport.count()]);
  assert.deepEqual(after, before);
  const noSession = await fetch(`${base}/api/v1/repositories`);
  assert.equal(noSession.status, 401);
  const blocked = await fetch(`${base}/api/v1/runs`, { method: "POST", headers: { origin: "https://evil.example", cookie, "content-type": "application/json" }, body });
  assert.equal(blocked.status, 403);
  console.log("PASS: real HTTP and PostgreSQL-backed session; curated catalog; 503; unchanged run/evidence counts; auth and origin rejections");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await prisma.$disconnect();
}
