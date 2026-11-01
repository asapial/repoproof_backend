// Trusted app/SQL integration only. No fixture, model or provider execution.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { Client } from "pg";
import type { AddressInfo } from "node:net";
import { authRateStorage } from "../src/lib/authRateLimit";

const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.RPF_LOCAL_DB_GATE !== "1" || url.hostname !== "127.0.0.1" || url.port !== "35440" || url.pathname !== "/rpf012s_disposable" || url.username !== "rpf_runtime_predeploy") throw new Error("Limited disposable database required");
const secret = `synthetic-security-${randomUUID()}`;
process.env.BETTER_AUTH_SECRET = secret;
process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_URL = "http://localhost:3001";
process.env.FRONTEND_URL = "http://localhost:3000";
delete process.env.VERCEL;
const { prisma } = await import("../src/lib/prisma");
const { default: app } = await import("../src/app");
const client = new Client({ connectionString: url.toString() }); await client.connect();
const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const email = `security-${randomUUID()}@example.test`;
const hash = (key: string) => createHmac("sha256", secret).update(`auth-rate:${key}`).digest("hex");
const headers = { origin: process.env.FRONTEND_URL, "content-type": "application/json" };
const post = (path: string, body: unknown, extra = {}) => fetch(`${base}/api/auth/${path}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
try {
  const storage = authRateStorage(prisma, secret);
  const results = await Promise.all(Array.from({ length: 20 }, () => storage.consume("owned-concurrent", { window: 60, max: 5 })));
  assert.equal(results.filter(result => result.allowed).length, 5, "atomic real SQL limit");
  await client.query('UPDATE "AuthRateBucket" SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE "key"=$1', [hash("client:owned-concurrent")]);
  assert.equal((await storage.consume("owned-concurrent", { window: 60, max: 5 })).allowed, true, "window recovery");
  const signup = await post("sign-up/email", { name: "Synthetic security", email, password: "owned-password-123" });
  assert.equal(signup.status, 200, "actual parsed-body Better Auth signup");
  const cookie = signup.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token="))!.split(";")[0]!;
  assert.equal((await fetch(`${base}/api/auth/get-session`, { headers: { cookie } })).status, 200);
  for (let index = 0; index < 5; index++) {
    const failed = await post("sign-in/email", { email, password: "wrong-password" }, { "x-repoproof-client-ip": `192.0.2.${index + 1}`, "x-forwarded-for": `192.0.2.${index + 1}` });
    assert.equal(failed.status, 401, "real failed login");
  }
  const limited = await post("sign-in/email", { email, password: "owned-password-123" }, { "x-repoproof-client-ip": "198.51.100.1" });
  assert.equal(limited.status, 429, "spoofed client headers cannot evade shared auth limit"); assert.ok(Number(limited.headers.get("x-retry-after")) > 0);
  const evil = await fetch(`${base}/api/v1/request-draft`, { method: "DELETE", headers: { cookie, origin: "http://evil.example" } }); assert.equal(evil.status, 403);
  const missing = await fetch(`${base}/api/v1/request-draft`, { method: "DELETE", headers: { cookie } }); assert.equal(missing.status, 403);
  const invalid = await fetch(`${base}/api/v1/request-draft`, { method: "PUT", headers: { ...headers, cookie }, body: '{"private-secret":' }); assert.equal(invalid.status, 400); assert.ok(!(await invalid.text()).includes("private-secret"));
  const logout = await post("sign-out", {}, { cookie }); assert.equal(logout.status, 200);
  const expired = await fetch(`${base}/api/v1/request-draft`, { headers: { cookie } }); assert.equal(expired.status, 401); assert.equal((await expired.json()).error.code, "UNAUTHENTICATED");
  console.log("PASS: real restricted-role SQL concurrency (5/20), window recovery, actual bounded-body signup/session, five failed logins then 429 despite spoofed headers, exact/missing origin denial, safe JSON errors, logout/session invalidation.");
} finally {
  await prisma.user.deleteMany({ where: { email } });
  await client.query('DELETE FROM "AuthRateBucket" WHERE "key"=ANY($1::text[])', [["global", "client:owned-concurrent", "client:127.0.0.1/sign-up/email", "client:127.0.0.1/sign-in/email", "client:127.0.0.1/get-session", "client:127.0.0.1/sign-out"].map(hash)]);
  await new Promise<void>(resolve => server.close(() => resolve())); await client.end(); await prisma.$disconnect();
}
