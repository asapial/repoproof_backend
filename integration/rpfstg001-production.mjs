import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const db = new URL(process.env.DATABASE_URL ?? "");
if (process.env.RPF_STAGE_SMOKE !== "1" || db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" || db.port !== "35440" || db.pathname !== "/rpf012s_disposable") throw new Error("Refusing non-disposable staging smoke target");
const base = "http://127.0.0.1:15442";
const origin = "https://app.staging.example.test";
const values = { NODE_ENV: "production", PORT: "15442", DATABASE_URL: process.env.DATABASE_URL, BETTER_AUTH_SECRET: "synthetic-test-secret-0123456789abcdef", BETTER_AUTH_URL: "https://api.staging.example.test", FRONTEND_URL: origin };
// Pass only OS process essentials and the explicitly synthetic test core.
const osEnv = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"].filter(name => process.env[name]).map(name => [name, process.env[name]]));
// Force a loopback bind for this local test while loading the actual production bundle.
const bootstrap = `import { Server } from "node:net"; import { pathToFileURL } from "node:url"; const listen=Server.prototype.listen; Server.prototype.listen=function(port, ...rest) { if (String(port)==="15442") return listen.call(this, Number(port), "127.0.0.1", ...rest); return listen.call(this, port, ...rest); }; await import(pathToFileURL(process.cwd()+"/api/server.js"));`;
for (const [override, missing] of [[{ BETTER_AUTH_SECRET: "" }, "BETTER_AUTH_SECRET"], [{ ENABLE_OPENROUTER: "true" }, "OpenRouter_API_KEY"], [{ ENABLE_CLOUDINARY: "true" }, "CLOUDINARY_CLOUD_NAME"], [{ ENABLE_SMTP: "true" }, "EMAIL_SENDER_SMTP_USER"], [{ ENABLE_GOOGLE_OAUTH: "true" }, "GOOGLE_CLIENT_ID"], [{ ENABLE_LEGACY_JWT: "true" }, "ACCESS_TOKEN_SECRET"], [{ BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN: "invalid" }, "BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN"]]) {
  const invalid = spawnSync(process.execPath, ["--input-type=module", "-e", bootstrap], { env: { ...osEnv, ...values, ...override }, encoding: "utf8", timeout: 10000 });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, new RegExp(missing));
  assert.doesNotMatch(invalid.stderr, /synthetic-test-secret-0123456789abcdef/);
}
const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], { env: { ...osEnv, ...values }, stdio: ["ignore", "pipe", "pipe"] });
let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk.toString(); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Production bundle exited ${child.exitCode}: ${stderr.slice(0, 1200)}`);
    try { const response = await fetch(base); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Production bundle did not start: ${stderr.slice(0, 1200)}`);
  const missing = await fetch(`${base}/api/v1/request-draft`); assert.equal(missing.status, 401);
  const email = `stage-${randomUUID()}@example.test`;
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Synthetic", email, password: "synthetic-password-123" }) });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().find(item => item.includes("better-auth.session_token="));
  assert.ok(cookie); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=None/i);
  const cookieHeader = cookie.split(";")[0];
  const session = await fetch(`${base}/api/auth/get-session`, { headers: { origin, cookie: cookieHeader } });
  const sessionBody = await session.json(); assert.equal(session.status, 200); assert.equal(sessionBody.user.email, email);
  assert.ok(Math.abs(Date.parse(sessionBody.session.expiresAt) - Date.now() - 604800000) < 10000, "effective default session lifetime");
  const loginHeaders = { origin, "content-type": "application/json" };
  const failedLogin = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: loginHeaders, body: JSON.stringify({ email, password: "wrong-password" }) }); assert.equal(failedLogin.status, 401);
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: loginHeaders, body: JSON.stringify({ email, password: "synthetic-password-123" }) }); assert.equal(login.status, 200);
  const response = await fetch(`${base}/api/v1/runs`, { method: "POST", headers: { origin, cookie: cookieHeader, "content-type": "application/json" }, body: JSON.stringify({ repositoryId: "repoproof-backend", fixtureKey: "discount-bug", issueNumber: 1 }) });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "RUNNER_UNAVAILABLE");
  const denied = await fetch(`${base}/api/v1/request-draft`, { method: "PUT", headers: { origin: "https://evil.example.test", cookie: cookieHeader, "content-type": "application/json" }, body: "{}" }); assert.equal(denied.status, 403);
  const csrf = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { cookie: cookieHeader, "content-type": "application/json" }, body: "{}" }); assert.equal(csrf.status, 403);
  const logout = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { ...loginHeaders, cookie: cookieHeader }, body: "{}" }); assert.equal(logout.status, 200);
  const expired = await fetch(`${base}/api/v1/request-draft`, { headers: { origin, cookie: cookieHeader } }); assert.equal(expired.status, 401);
  console.log("PASS: production bundle starts with core-only config and loopback test binding; rejects missing core/provider credentials; secure cookies, auth, origin denial and RUNNER_UNAVAILABLE");
} finally { child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve)); }
