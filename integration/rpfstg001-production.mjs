import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const db = new URL(process.env.DATABASE_URL ?? "");
if (process.env.RPF_STAGE_SMOKE !== "1" || db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" || db.port !== "35440" || db.pathname !== "/rpf012s_disposable") throw new Error("Refusing non-disposable staging smoke target");
const base = "http://127.0.0.1:15442";
const origin = "https://app.staging.example.test";
const values = { NODE_ENV: "production", PORT: "15442", DATABASE_URL: process.env.DATABASE_URL, BETTER_AUTH_SECRET: "synthetic-test-secret-0123456789abcdef", BETTER_AUTH_URL: "https://api.staging.example.test", FRONTEND_URL: origin, ACCESS_TOKEN_SECRET: "synthetic", REFRESH_TOKEN_SECRET: "synthetic", ACCESS_TOKEN_EXPIRES_IN: "1h", REFRESH_TOKEN_EXPIRES_IN: "1d", BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN: "3600", BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE: "300" };
for (const name of ["EMAIL_SENDER_SMTP_USER", "EMAIL_SENDER_SMTP_PASS", "EMAIL_SENDER_SMTP_HOST", "EMAIL_SENDER_SMTP_PORT", "EMAIL_SENDER_SMTP_FROM", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "OpenRouter_API_KEY"]) values[name] = "synthetic";
// Force a loopback bind for this local test while loading the actual production bundle.
const bootstrap = `import { Server } from "node:net"; import { pathToFileURL } from "node:url"; const listen=Server.prototype.listen; Server.prototype.listen=function(port, ...rest) { if (String(port)==="15442") return listen.call(this, Number(port), "127.0.0.1", ...rest); return listen.call(this, port, ...rest); }; await import(pathToFileURL(process.cwd()+"/api/server.js"));`;
const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], { env: { ...process.env, ...values }, stdio: ["ignore", "pipe", "pipe"] });
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
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Synthetic", email: `stage-${randomUUID()}@example.test`, password: "synthetic-password-123" }) });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().find(item => item.includes("better-auth.session_token="));
  assert.ok(cookie); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=None/i);
  const cookieHeader = cookie.split(";")[0];
  const response = await fetch(`${base}/api/v1/runs`, { method: "POST", headers: { origin, cookie: cookieHeader, "content-type": "application/json" }, body: JSON.stringify({ repositoryId: "repoproof-backend", fixtureKey: "discount-bug", issueNumber: 1 }) });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "RUNNER_UNAVAILABLE");
  const denied = await fetch(`${base}/api/v1/request-draft`, { method: "PUT", headers: { origin: "https://evil.example.test", cookie: cookieHeader, "content-type": "application/json" }, body: "{}" }); assert.equal(denied.status, 403);
  console.log("PASS: production bundle starts with loopback test binding; secure cookies, auth, origin denial and RUNNER_UNAVAILABLE");
} finally { child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve)); }
