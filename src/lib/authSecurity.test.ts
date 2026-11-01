import { describe, expect, it } from "vitest";
import { Router } from "express";
import { createApp } from "../appFactory";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { securityConfig } from "../config/security";
import { authSecurityOptions } from "./authSecurity";
import type { AddressInfo } from "node:net";

const origin = "http://localhost:3000";
async function withServer(production: boolean, test: (base: string) => Promise<void>, sameOrigin = false) {
  const security = securityConfig(production ? "https://frontend.example" : origin, production);
  const auth = betterAuth({ ...authSecurityOptions(security.allowedOrigin, production, sameOrigin), baseURL: sameOrigin ? security.allowedOrigin : "http://localhost:3001", secret: "test-only-secret-with-at-least-32-characters" });
  const router = Router();
  router.post("/test", (_req, res) => res.json({ ok: true }));
  const app = createApp(toNodeHandler(auth), router, security.allowedOrigin, production, production ? "https://backend.example" : "http://localhost:3001");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try { await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

describe("authentication and origin security", () => {
  it("performs signup, session lookup, signout and rejects invalid credentials and CSRF", async () => {
    await withServer(false, async base => {
      const headers = { origin, "content-type": "application/json" };
      const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ name: "Test User", email: "user@example.test", password: "strong-test-password" }) });
      expect(signup.status).toBe(200);
      const cookie = signup.headers.getSetCookie().find(v => v.startsWith("better-auth.session_token="));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Lax/i); expect(cookie).toMatch(/Path=\//i); expect(cookie).not.toMatch(/; Secure/i);
      const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email: "user@example.test", password: "strong-test-password" }) });
      expect(login.status).toBe(200);
      const sessionCookie = cookie!.split(";")[0]!;
      const session = await fetch(`${base}/api/auth/get-session`, { headers: { origin, cookie: sessionCookie } });
      expect(session.status).toBe(200); expect((await session.json()).user.email).toBe("user@example.test");
      const invalid = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email: "user@example.test", password: "wrong-password" }) });
      expect(invalid.status).toBe(401);
      const badOrigin = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin: "https://evil.vercel.app", "content-type": "application/json" }, body: JSON.stringify({ email: "user@example.test", password: "strong-test-password" }) });
      expect(badOrigin.status).toBe(403);
      const csrf = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie }, body: "{}" });
      expect(csrf.status).toBe(403);
      const signout = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { ...headers, cookie: sessionCookie }, body: "{}" });
      expect(signout.status).toBe(200);
      const signedOut = await fetch(`${base}/api/auth/get-session`, { headers: { origin, cookie: sessionCookie } });
      expect(await signedOut.json()).toBeNull();
    });
  });
  it("enforces trusted CORS, preflight and cookie request origins", async () => {
    await withServer(false, async base => {
      const preflight = await fetch(`${base}/api/v1/test`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
      expect(preflight.status).toBe(204); expect(preflight.headers.get("access-control-allow-origin")).toBe(origin); expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
      expect(preflight.headers.get("access-control-allow-methods")).toContain("POST"); expect(preflight.headers.get("access-control-allow-headers")).toContain("Content-Type");
      const evil = await fetch(`${base}/api/v1/test`, { method: "POST", headers: { origin: "https://evil.vercel.app", cookie: "accessToken=x" } });
      expect(evil.status).toBe(403); expect(evil.headers.get("access-control-allow-origin")).toBeNull();
      expect((await fetch(`${base}/api/v1/test`, { method: "POST", headers: { cookie: "accessToken=x" } })).status).toBe(403);
      expect((await fetch(`${base}/api/v1/test`, { method: "POST", headers: { origin, cookie: "accessToken=x" } })).status).toBe(200);
    });
  });
  it("sets production cookies to HttpOnly, Secure and SameSite=None", async () => {
    await withServer(true, async base => {
      const res = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin: "https://frontend.example", "content-type": "application/json" }, body: JSON.stringify({ name: "Test", email: "prod@example.test", password: "strong-test-password" }) });
      expect(res.status).toBe(200);
      const cookie = res.headers.getSetCookie().find(v => v.startsWith("__Secure-better-auth.session_token="));
      expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/; Secure/i); expect(cookie).toMatch(/SameSite=None/i); expect(cookie).toMatch(/Path=\//i);
    });
  });
  it("rejects wildcard, non-origin and insecure production configuration", () => {
    for (const url of ["https://*.example.com", "https://example.com/path", "http://localhost:3000", "https://user:password@example.com"]) expect(() => securityConfig(url, true)).toThrow();
    expect(() => securityConfig("https://frontend.example", true, "http://backend.example")).toThrow();
  });
  it("uses host-only Secure HttpOnly Lax cookies for a same-origin production proxy", async () => {
    await withServer(true, async base => {
      const response = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin: "https://frontend.example", "content-type": "application/json" }, body: JSON.stringify({ name: "Proxy test", email: "proxy@example.test", password: "synthetic-password-123" }) });
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().find(value => value.startsWith("__Secure-better-auth.session_token="));
      expect(cookie).toMatch(/Secure/i); expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Lax/i); expect(cookie).not.toMatch(/Domain=/i);
    }, true);
  });
});
