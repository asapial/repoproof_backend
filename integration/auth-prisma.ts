import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import dotenv from "dotenv";
import { Router } from "express";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/prisma/client";
import { createApp } from "../src/appFactory";
import { authSecurityOptions } from "../src/lib/authSecurity";

const config = dotenv.parse(readFileSync(".env"));
const url = new URL(config.DATABASE_URL ?? "");
// Require an independently verified test target on every invocation.
const expectedHost = process.env.RPF_TEST_DATABASE_HOST;
const expectedName = process.env.RPF_TEST_DATABASE_NAME;
if (!expectedHost || !expectedName || url.hostname !== expectedHost || url.pathname !== `/${expectedName}` || url.searchParams.get("sslmode") !== "require") throw new Error("Unapproved database target");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
const origin = "http://localhost:3000";
const email = `rpf-sec-001-${randomUUID()}@example.test`;
const password = "test-password-not-a-real-secret";
const headers = { origin, "content-type": "application/json" };
let created = false;
const auth = betterAuth({ ...authSecurityOptions(origin, false), database: prismaAdapter(prisma, { provider: "postgresql" }), baseURL: "http://localhost:3001", secret: "test-only-secret-with-at-least-32-characters" });
const router = Router();
router.post("/test", (_req, res) => res.json({ ok: true }));
const app = createApp(toNodeHandler(auth), router, origin, false, "http://localhost:3001");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(identity[0]?.name, expectedName);
  assert.equal(await prisma.user.findUnique({ where: { email } }), null);
  created = true;
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ name: "Synthetic test", email, password }) });
  assert.equal(signup.status, 200, "signup");
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200, "login");
  const cookie = login.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token="));
  assert.ok(cookie); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Path=\//i); assert.doesNotMatch(cookie, /; Secure/i);
  const tokenCookie = cookie.split(";")[0]!;
  const badLogin = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password: "wrong-password" }) });
  assert.equal(badLogin.status, 401, "invalid password");
  const session = await fetch(`${base}/api/auth/get-session`, { headers: { origin, cookie: tokenCookie } });
  assert.equal(session.status, 200); assert.equal((await session.json()).user.email, email);
  const csrf = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { cookie: tokenCookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(csrf.status, 403, "CSRF rejection");
  const cors = await fetch(`${base}/api/v1/test`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
  assert.equal(cors.status, 204); assert.equal(cors.headers.get("access-control-allow-origin"), origin); assert.equal(cors.headers.get("access-control-allow-credentials"), "true");
  const blocked = await fetch(`${base}/api/v1/test`, { method: "POST", headers: { origin: "https://evil.vercel.app", cookie: tokenCookie } });
  assert.equal(blocked.status, 403); assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  const productionOrigin = "https://frontend.example";
  const productionAuth = betterAuth({ ...authSecurityOptions(productionOrigin, true), database: prismaAdapter(prisma, { provider: "postgresql" }), baseURL: "https://backend.example", secret: "test-only-secret-with-at-least-32-characters" });
  const productionApp = createApp(toNodeHandler(productionAuth), Router(), productionOrigin, true, "https://backend.example");
  const productionServer = productionApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { productionServer.once("listening", resolve); productionServer.once("error", reject); });
  try {
    const productionBase = `http://127.0.0.1:${(productionServer.address() as AddressInfo).port}`;
    const response = await fetch(`${productionBase}/api/auth/sign-in/email`, { method: "POST", headers: { origin: productionOrigin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200, "production login");
    const productionCookie = response.headers.getSetCookie().find(value => value.startsWith("__Secure-better-auth.session_token="));
    assert.ok(productionCookie); assert.match(productionCookie, /HttpOnly/i); assert.match(productionCookie, /; Secure/i); assert.match(productionCookie, /SameSite=None/i); assert.match(productionCookie, /Path=\//i);
  } finally { await new Promise<void>((resolve, reject) => productionServer.close(error => error ? reject(error) : resolve())); }
  const signout = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { ...headers, cookie: tokenCookie }, body: "{}" });
  assert.equal(signout.status, 200);
  const after = await fetch(`${base}/api/auth/get-session`, { headers: { origin, cookie: tokenCookie } });
  assert.equal(await after.json(), null, "session invalidation");
  console.log("Prisma auth integration passed: signup, login, rejected login, session, CSRF, development and production cookies, CORS, untrusted origin, logout");
} finally {
  if (created) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) { await prisma.session.deleteMany({ where: { userId: user.id } }); await prisma.account.deleteMany({ where: { userId: user.id } }); await prisma.user.deleteMany({ where: { id: user.id, email } }); }
    console.log("Synthetic test user and associated sessions/accounts removed");
  }
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
