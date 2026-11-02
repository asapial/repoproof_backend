// Real owned PostgreSQL and HTTP session revocation, including legacy signed
// caches. All data is synthetic; external network, model and runner calls denied.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authSecurityOptions } from "../src/lib/authSecurity";

const target = new URL(process.env.DATABASE_URL ?? ""), origin = "http://localhost:3000";
if (target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" || target.port !== "35440" ||
  target.pathname !== "/rpf_product_disposable" || target.username !== "rpf_product_runtime" ||
  process.env.RPF_LOCAL_SESSION_GATE !== "1") throw new Error("Refusing non-disposable or privileged session gate");
assert.equal(process.version,"v24.22.2");
const nativeFetch = globalThis.fetch; let externalAttempts = 0;
globalThis.fetch = async (input,init) => {
  if (new URL(String(input)).hostname !== "127.0.0.1") { externalAttempts++; throw new Error("External network denied by local session gate"); }
  return nativeFetch(input,init);
};
const { prisma } = await import("../src/lib/prisma");
const bundled = process.env.RPF_SESSION_USE_BUNDLE === "1";
const { default: app }: typeof import("../src/app") = bundled ? await import(new URL("../function-build/app.js",import.meta.url).href) : await import("../src/app");
const legacy = betterAuth({ ...authSecurityOptions(origin,false),database: prismaAdapter(prisma,{ provider: "postgresql" }),
  baseURL: "http://localhost:5000",secret: process.env.BETTER_AUTH_SECRET!,session: { cookieCache: { enabled: true,maxAge: 300 } },
  logger: { level: "error",log: () => {} } });
const observer = new pg.Pool({ connectionString: "postgresql://rpf_test@127.0.0.1:35440/rpf_product_disposable",max: 1 });
const users: string[] = [], password = "synthetic-password-123", email = `session-${randomUUID()}@example.test`;
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
const server = app.listen(0,"127.0.0.1");
await new Promise<void>((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
try {
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const counts = async () => (await observer.query('SELECT (SELECT count(*)::int FROM "Run") AS runs, (SELECT count(*)::int FROM "VerificationReport") AS reports, (SELECT count(*)::int FROM "Artifact") AS artifacts')).rows;
  const before = await counts(); await assert.rejects(prisma.run.count());
  const post = (path: string,cookie: string,body: unknown = {},sendOrigin = true) => fetch(base+"/api/auth/"+path,{ method: "POST",
    headers: { cookie,...(sendOrigin ? { origin } : {}),"content-type": "application/json" },body: JSON.stringify(body) });
  const getSession = (cookie: string) => fetch(base+"/api/auth/get-session",{ headers: { cookie } });
  const makeLegacy = async (address: string,signup: boolean) => {
    const response = signup ? await legacy.api.signUpEmail({ body: { name: "Synthetic legacy session",email: address,password },asResponse: true }) :
      await legacy.api.signInEmail({ body: { email: address,password },asResponse: true });
    assert.equal(response.status,200); const data = await response.json(), cookie = cookies(response);
    if (signup) users.push(data.user.id);
    assert.ok(cookie.includes("session_data=")); return { cookie,token: data.token as string,userId: data.user.id as string };
  };
  const denied = async (cookie: string) => {
    const session = await getSession(cookie); assert.equal(session.status,200); assert.equal((await session.json()) === null,true);
    for (const path of ["/api/v1/repositories","/api/v1/request-draft","/api/v1/repositories/repoproof-backend/issues"]) assert.equal((await fetch(base+path,{ headers: { cookie } })).status,401);
    assert.equal((await post("update-user",cookie,{ name: "must-not-change" })).status,401);
  };
  const a = await makeLegacy(email,true), other = await makeLegacy(`session-other-${randomUUID()}@example.test`,true), second = await makeLegacy(email,false);
  const valid = await getSession(a.cookie); assert.equal(valid.status,200); assert.equal((await valid.json()).user.id,a.userId);
  assert.ok(valid.headers.getSetCookie().some(value => value.startsWith("better-auth.session_data=") && /Max-Age=0/.test(value)));
  // A different owner cannot revoke A even if the private test supplies A's token.
  assert.equal((await post("revoke-session",other.cookie,{ token: a.token })).status,200);
  assert.equal((await (await getSession(a.cookie)).json()).user.id,a.userId);
  assert.equal((await post("revoke-other-sessions",a.cookie,{},false)).status,403);
  assert.equal((await post("revoke-other-sessions",a.cookie)).status,200);
  assert.equal(await prisma.session.count({ where: { userId: a.userId } }),1);
  await denied(second.cookie); await denied(second.cookie);
  assert.equal((await (await getSession(other.cookie)).json()).user.id,other.userId);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: a.userId } })).name,"Synthetic legacy session");
  assert.equal((await post("sign-out",a.cookie)).status,200); await denied(a.cookie);
  const expiring = await makeLegacy(email,false);
  await prisma.session.updateMany({ where: { userId: a.userId,token: expiring.token },data: { expiresAt: new Date(Date.now()-1000) } });
  await denied(expiring.cookie);
  const current = await makeLegacy(email,false), device = await makeLegacy(email,false), replacement = "synthetic-new-password-456";
  const wrong = await post("change-password",current.cookie,{ currentPassword: "wrong-password",newPassword: replacement,revokeOtherSessions: true });
  assert.ok([400,401].includes(wrong.status));
  assert.equal((await (await getSession(device.cookie)).json()).user.id,a.userId);
  const changed = await post("change-password",current.cookie,{ currentPassword: password,newPassword: replacement,revokeOtherSessions: true });
  assert.equal(changed.status,200); const replacementCookie = cookies(changed); assert.ok(replacementCookie.includes("session_token="));
  assert.equal((await (await getSession(replacementCookie)).json()).user.id,a.userId);
  await denied(device.cookie); await denied(current.cookie);
  assert.equal((await post("sign-in/email","",{ email,password })).status,401);
  assert.equal((await post("sign-in/email","",{ email,password: replacement })).status,200);
  assert.equal((await (await getSession(other.cookie)).json()).user.id,other.userId);
  assert.equal(externalAttempts,0); assert.deepEqual(await counts(),before);
  console.log(JSON.stringify({ result: "PASS",scope: "LOCAL_POSTGRES_AUTHORITATIVE_SESSION_REVOCATION",limitedRuntimeRole: true,
    backendMode: bundled ? "EXPORTED_FUNCTION_BUNDLE" : "SOURCE",
    legacySignedCaches: true,cases: ["other-device","cross-user-denial","missing-origin","legacy-cookie-cleanup","replay","signout","server-expiry","wrong-password","password-change-revocation","new-password"],
    productRowsUnchanged: true,externalAttempts,fixtureCodeExecutions: 0,modelCalls: 0,sandboxCalls: 0 }));
} finally {
  globalThis.fetch = nativeFetch;
  try { for (const id of users) await prisma.user.deleteMany({ where: { id } }); }
  finally {
    server.closeAllConnections(); await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect(); await observer.end();
  }
}
