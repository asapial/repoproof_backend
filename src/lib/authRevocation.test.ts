import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { AddressInfo } from "node:net";
import { createApp } from "../appFactory";
import { createSafeMvpRouter } from "../safeMvp/router";
import { authSecurityOptions } from "./authSecurity";

const origin = "http://localhost:3000";
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
function authPair() {
  const database = memoryAdapter({ user: [],session: [],account: [],verification: [] }), options = { ...authSecurityOptions(origin,false),database,baseURL: "http://localhost:5000",
    secret: "synthetic-revocation-session-secret-0123456789",logger: { level: "error" as const,log: () => {} } };
  const auth = betterAuth(options);
  // Same store/key and real signed cookies from the previous application policy.
  // This proves upgrade safety, even after new logins stop creating cache cookies.
  const legacy = betterAuth({ ...options,session: { ...options.session,cookieCache: { enabled: true,maxAge: 300 } } });
  return { auth,legacy };
}
async function withServer(test: (h: ReturnType<typeof authPair> & { base: string }) => Promise<void>) {
  const { auth,legacy } = authPair();
  const router = createSafeMvpRouter(async req => Boolean((await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }))?.user.id));
  const server = createApp(toNodeHandler(auth),router,origin,false).listen(0,"127.0.0.1");
  await new Promise<void>((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
  try { await test({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,legacy,auth }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
}
async function signUp(legacy: ReturnType<typeof authPair>["legacy"],email: string) {
  const response = await legacy.api.signUpEmail({ body: { name: "Synthetic legacy user",email,password: "synthetic-password-123" },asResponse: true });
  expect(response.status).toBe(200); const cookie = cookies(response);
  expect(cookie.includes("session_data=")).toBe(true);
  return { cookie,token: (await response.json()).token as string };
}
const post = (base: string,path: string,cookie: string) => fetch(base+"/api/auth/"+path,{ method: "POST",headers: { origin,cookie,"content-type": "application/json" },body: "{}" });
async function denied(base: string,cookie: string) {
  const response = await fetch(base+"/api/auth/get-session",{ headers: { cookie } });
  expect(response.status).toBe(200); expect((await response.json()) === null).toBe(true);
  expect((await fetch(base+"/api/v1/repositories",{ headers: { cookie } })).status).toBe(401);
}
describe("authoritative session revocation with genuine legacy signed caches (memory store)", () => {
  it("revokes another device immediately while preserving the current and unrelated user", async () => withServer(async h => {
    const first = await signUp(h.legacy,"same@example.test"), other = await signUp(h.legacy,"other@example.test");
    const second = await h.legacy.api.signInEmail({ body: { email: "same@example.test",password: "synthetic-password-123" },asResponse: true });
    expect(second.status).toBe(200); const stale = cookies(second); expect(stale.includes("session_data=")).toBe(true);
    expect((await fetch(h.base+"/api/v1/repositories",{ headers: { cookie: stale } })).status).toBe(200);
    expect((await post(h.base,"revoke-other-sessions",first.cookie)).status).toBe(200);
    await denied(h.base,stale);
    for (const cookie of [first.cookie,other.cookie]) expect((await fetch(h.base+"/api/v1/repositories",{ headers: { cookie } })).status).toBe(200);
  }));
  it("does not let a signed cached session survive sign-out or replay", async () => withServer(async h => {
    const user = await signUp(h.legacy,"logout@example.test");
    expect((await post(h.base,"sign-out",user.cookie)).status).toBe(200);
    await denied(h.base,user.cookie); await denied(h.base,user.cookie);
  }));
  it("honors server-side expiry even when the legacy cache claims a future expiry", async () => withServer(async h => {
    const user = await signUp(h.legacy,"expired@example.test");
    await (await h.auth.$context).internalAdapter.updateSession(user.token,{ expiresAt: new Date(Date.now()-1000) });
    await denied(h.base,user.cookie);
  }));
});
