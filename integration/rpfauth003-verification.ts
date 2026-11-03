// Actual native auth, restricted local SQL, authenticated TLS sink and source /
// exported Function HTTP. Expired/forged tokens are labeled synthetic negatives.
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { createEmailVerificationToken } from "better-auth/api";
import pg from "pg";
import { verificationMailSink } from "./verificationMailSink";
import { emailVerificationPurpose } from "../src/lib/emailVerificationToken";

const target = new URL(process.env.DATABASE_URL ?? ""), bundled = process.env.RPF_VERIFICATION_USE_BUNDLE === "1", secret = process.env.BETTER_AUTH_SECRET!;
if (process.env.RPF_LOCAL_VERIFICATION_GATE !== "1" || target.hostname !== "127.0.0.1" || target.port !== "35441" || target.pathname !== "/rpf_verification_disposable" || target.username !== "rpf_verification_runtime" || process.env.ENABLE_EMAIL_VERIFICATION !== "true" || process.env.EMAIL_SENDER_SMTP_HOST !== "127.0.0.1" || process.env.EMAIL_SENDER_SMTP_PORT !== "15443") throw new Error("Refusing non-disposable verification gate");
assert.equal(process.version, "v24.22.2");
const fetchBefore = globalThis.fetch, errorBefore = console.error, errors: string[] = []; let externalAttempts = 0;
globalThis.fetch = async (input, options) => { if (new URL(String(input)).hostname !== "127.0.0.1") { externalAttempts++; throw new Error("External verification network denied"); } return fetchBefore(input, options); };
console.error = (...values: unknown[]) => { errors.push(values.map(String).join(" ")); errorBefore(...values); };
const mail = await verificationMailSink(), { prisma } = await import("../src/lib/prisma");
const { default: app }: typeof import("../src/app") = bundled ? await import(new URL("../function-build/app.js", import.meta.url).href) : await import("../src/app");
const observer = new pg.Pool({ connectionString: "postgresql://rpf_test@127.0.0.1:35441/rpf_verification_disposable", max: 1 });
const server = app.listen(0, "127.0.0.1"), origin = "http://localhost:3000", users: string[] = [];
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, clientAddress = `127.18.${randomInt(1, 255)}.${randomInt(2, 255)}`;
const post = (path: string, body: unknown, cookie = "", sentOrigin: string | null = origin) => new Promise<Response>((resolve, reject) => {
  const request = httpRequest(new URL(path, base), { localAddress: clientAddress, method: "POST", headers: { "content-type": "application/json", cookie, ...(sentOrigin === null ? {} : { origin: sentOrigin }) } }, response => {
    const chunks: Buffer[] = [], headers = new Headers(); let bytes = 0;
    for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
    response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) response.destroy(new Error("Oversized local verification response")); else chunks.push(chunk); });
    response.on("error", reject); response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode!, headers })));
  });
  request.setTimeout(10000, () => request.destroy(new Error("Local verification deadline"))); request.on("error", reject); request.end(JSON.stringify(body));
});
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
const get = (path: string, cookie = "") => fetch(base + path, { headers: { cookie } });
async function safeError(response: Response, status: number, code: string) { assert.equal(response.status, status); const body = await response.json(); assert.equal(body.error?.code, code); assert.equal(typeof body.error.requestId, "string"); assert.ok(!JSON.stringify(body).includes("PRIVATE")); }
try {
  const counts = async () => (await observer.query('SELECT (SELECT count(*)::int FROM "Run") AS runs,(SELECT count(*)::int FROM "VerificationReport") AS reports,(SELECT count(*)::int FROM "Artifact") AS artifacts')).rows;
  const before = await counts(); assert.deepEqual(before, [{ runs: 0, reports: 0, artifacts: 0 }]); await assert.rejects(prisma.run.count());
  assert.equal((await prisma.$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`)[0]?.role, "rpf_verification_runtime");
  const capabilities = await get("/api/v1/email-verification"); assert.deepEqual(await capabilities.json(), { enabled: true }); assert.equal(capabilities.headers.get("cache-control"), "no-store");
  assert.deepEqual(await (await get("/api/v1/auth-capabilities")).json(), { passwordReset: { enabled: true } });
  const email = `verify-${randomUUID()}@example.test`, otherEmail = `other-${randomUUID()}@example.test`, password = "synthetic-verification-password";
  const signup = async (address: string) => { const response = await post("/api/auth/sign-up/email", { name: "Synthetic verification", email: address, password }); assert.equal(response.status, 200); const body = await response.json(); users.push(body.user.id); return { id: body.user.id as string, cookie: cookieOf(response) }; };
  const a = await signup(email); assert.equal((await mail.message(0)).email, email); const b = await signup(otherEmail); assert.equal((await mail.message(1)).email, otherEmail);
  assert.deepEqual(await (await get("/api/v1/email-verification/account", a.cookie)).json(), { email, verified: false, enabled: true });
  await safeError(await post("/api/v1/email-verification/request", {}), 401, "UNAUTHENTICATED");
  await safeError(await post("/api/v1/email-verification/request", { email: otherEmail }, a.cookie), 400, "INVALID_INPUT");
  for (let index = 2; index <= 3; index++) { assert.equal((await post("/api/v1/email-verification/request", {}, a.cookie)).status, 202); assert.equal((await mail.message(index)).email, email); }
  const limited = await post("/api/v1/email-verification/request", {}, a.cookie); await safeError(limited, 429, "EMAIL_VERIFICATION_RATE_LIMITED"); assert.equal(limited.headers.get("retry-after"), "900"); assert.equal(mail.messages.length, 4);
  const token = mail.messages[0]!.token, claims = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
  assert.equal(claims.email, email); assert.equal(claims.purpose, emailVerificationPurpose); assert.equal(claims.exp! - claims.iat!, 900);
  assert.ok(!JSON.stringify((await observer.query('SELECT "identifier","value" FROM public."verification"')).rows).includes(token));
  const passwordsBefore = (await observer.query('SELECT "password" FROM public."account" WHERE "userId" = ANY($1::text[]) ORDER BY "userId"', [users])).rows;
  const sessionsBefore = await prisma.session.count({ where: { userId: { in: users } } });
  await observer.query('REVOKE UPDATE ON public."user" FROM rpf_verification_runtime');
  try { await safeError(await post("/api/v1/email-verification/confirm", { token }, b.cookie), 503, "EMAIL_VERIFICATION_UNAVAILABLE"); }
  finally { await observer.query('GRANT UPDATE ON public."user" TO rpf_verification_runtime'); }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).emailVerified, false);
  for (let index = 0; index < 2; index++) { const response = await post("/api/v1/email-verification/confirm", { token }, b.cookie); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: true }); assert.deepEqual(response.headers.getSetCookie(), []); }
  assert.deepEqual(await (await get("/api/v1/email-verification/account", a.cookie)).json(), { email, verified: true, enabled: true });
  assert.deepEqual(await (await get("/api/v1/email-verification/account", b.cookie)).json(), { email: otherEmail, verified: false, enabled: true });
  assert.equal((await get("/api/auth/get-session").then(response => response.json())) === null, true);
  assert.equal(await prisma.session.count({ where: { userId: { in: users } } }), sessionsBefore);
  assert.ok(JSON.stringify((await observer.query('SELECT "password" FROM public."account" WHERE "userId" = ANY($1::text[]) ORDER BY "userId"', [users])).rows) === JSON.stringify(passwordsBefore));
  assert.equal((await post("/api/v1/email-verification/request", {}, a.cookie)).status, 202); assert.equal(mail.messages.length, 4);
  // Synthetic, correctly signed expired/wrong-scope/algorithm negatives. No clock
  // changes or claim of a real elapsed 15-minute wait.
  const now = Math.floor(Date.now() / 1000), payload = { email: otherEmail, purpose: emailVerificationPurpose, iat: now, exp: now + 900 };
  const negatives = [await createEmailVerificationToken(secret, otherEmail, undefined, 900), jwt.sign({ ...payload, iat: now - 901, exp: now - 1 }, secret), jwt.sign({ ...payload, updateTo: email }, secret), jwt.sign(payload, secret, { algorithm: "HS512" })];
  for (const token of negatives) await safeError(await post("/api/v1/email-verification/confirm", { token }), 400, "EMAIL_VERIFICATION_LINK_INVALID");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).emailVerified, false);
  await safeError(await post("/api/v1/email-verification/confirm", { token }, "", null), 403, "ORIGIN_REQUIRED");
  await safeError(await post("/api/v1/email-verification/confirm?token=PRIVATE", { token }), 400, "INVALID_INPUT");
  for (let remaining = 0; remaining < 3; remaining++) assert.equal((await post("/api/v1/email-verification/confirm", { token })).status, 200);
  await safeError(await post("/api/v1/email-verification/confirm", { token }), 429, "EMAIL_VERIFICATION_RATE_LIMITED");
  for (const path of ["/api/auth/verify-email?token=" + token, "/api/auth/verify-email/?token=" + token]) assert.equal((await get(path)).status, 404);
  assert.equal((await post("/api/auth/send-verification-email", { email: otherEmail }, b.cookie)).status, 404);
  assert.equal((await post("/api/auth/sign-out", {}, b.cookie)).status, 200); await safeError(await get("/api/v1/email-verification/account", b.cookie), 401, "UNAUTHENTICATED");
  for (const forbidden of [email, otherEmail, ...mail.messages.map(item => item.token), secret, "synthetic-smtp-password"]) assert.ok(!errors.join("\n").includes(forbidden), "Verification private material reached logs");
  assert.equal(externalAttempts, 0); assert.deepEqual(await counts(), before);
  console.log(JSON.stringify({ result: "PASS", scope: "OWNED_LOCAL_POSTGRES_TLS_EMAIL_VERIFICATION", backendMode: bundled ? "EXPORTED_FUNCTION_BUNDLE" : "SOURCE", syntheticClientAddress: clientAddress, limitedRuntimeRole: true, actualTlsMessages: 4, nativeSignupMailAndResend: true, realOwnerStatusAndConfirmation: true, noAutoLoginOrEmailPasswordChange: true, unrelatedOwnerUnchanged: true, idempotentConfirmation: true, actualSqlFailureSafeRetry: true, sharedSqlDeliveryAndIpLimits: true, nativeQueryEndpointsDisabled: true, syntheticExpiredAndWrongScopeNegatives: true, productRows: before, externalEmail: 0, externalAttempts, modelCalls: 0, sandboxCalls: 0, fixtureExecutions: 0 }));
} finally {
  globalThis.fetch = fetchBefore; console.error = errorBefore;
  try { for (const id of users) await prisma.user.deleteMany({ where: { id } }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await mail.close(); await prisma.$disconnect(); await observer.end(); }
}
