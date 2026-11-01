import assert from "node:assert/strict";
import { Server } from "node:net";
import { randomUUID } from "node:crypto";

const database = new URL(process.env.DATABASE_URL ?? "");
if (process.env.RPF_STAGE_SMOKE !== "1" || database.hostname !== "127.0.0.1" || database.port !== "35440" || database.pathname !== "/rpf012s_disposable") throw new Error("Refusing non-disposable function smoke target");
assert.equal(process.env.NODE_ENV, "production");
assert.equal(process.env.PORT, undefined, "Function import must not require PORT");
const original = Server.prototype.listen;
Server.prototype.listen = function () { throw new Error("Function import attempted a persistent HTTP listener"); };
let app;
try { ({ default: app } = await import("../function-build/app.js")); }
finally { Server.prototype.listen = original; }
assert.equal(typeof app, "function");
// The harness supplies an ephemeral loopback HTTP adapter only after import.
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: "ok" });
  const ready = await fetch(`${base}/readyz`); assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { status: "ready" });
  assert.equal((await fetch(`${base}/api/v1/request-draft`)).status, 401);
  const origin = process.env.FRONTEND_URL;
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.10" }, body: JSON.stringify({ name: "Synthetic function", email: `function-${randomUUID()}@example.test`, password: "synthetic-password-123" }) });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().find(value => value.startsWith("__Secure-better-auth.session_token="));
  assert.ok(cookie); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i); assert.doesNotMatch(cookie, /Domain=/i);
  const headers = { origin, cookie: cookie.split(";")[0], "content-type": "application/json" };
  const run = await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ repositoryId: "repoproof-backend", fixtureKey: "discount-bug", issueNumber: 1 }) });
  assert.equal(run.status, 503); assert.equal((await run.json()).error.code, "RUNNER_UNAVAILABLE");
  assert.equal((await fetch(`${base}/api/v1/request-draft`, { method: "DELETE", headers: { ...headers, origin: "https://evil.example.test" } })).status, 403);
  console.log("PASS: production Function bundle imports with no PORT/listener, completes health/readiness/auth/CSRF requests and returns RUNNER_UNAVAILABLE; host-only Secure HttpOnly Lax cookie");
} finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
