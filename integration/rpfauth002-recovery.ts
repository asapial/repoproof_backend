// Owned local PostgreSQL + authenticated TLS SMTP sink + actual source/Function
// HTTP. No external email, model, Sandbox or repository execution is permitted.
import assert from "node:assert/strict";
import { randomUUID, randomInt, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createTlsServer, type TLSSocket } from "node:tls";
import pg from "pg";

const target = new URL(process.env.DATABASE_URL ?? ""), bundled = process.env.RPF_RECOVERY_USE_BUNDLE === "1";
if (target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" || target.port !== "35441" ||
  target.pathname !== "/rpf_recovery_disposable" || target.username !== "rpf_recovery_runtime" ||
  process.env.RPF_LOCAL_RECOVERY_GATE !== "1" || process.env.EMAIL_SENDER_SMTP_HOST !== "127.0.0.1" ||
  process.env.EMAIL_SENDER_SMTP_PORT !== "15443" || process.env.EMAIL_SENDER_SMTP_SECURE !== "true") throw new Error("Refusing a non-disposable recovery target");
assert.equal(process.version, "v24.22.2");
const nativeFetch = globalThis.fetch, errors: string[] = [], nativeError = console.error;
let externalAttempts = 0, mailRejected = false, smtpConnections = 0;
globalThis.fetch = async (input, init) => {
  if (!["127.0.0.1", "[::1]"].includes(new URL(String(input)).hostname)) { externalAttempts++; throw new Error("External network denied by recovery gate"); }
  return nativeFetch(input, init);
};
console.error = (...values: unknown[]) => { errors.push(values.map(String).join(" ")); nativeError(...values); };
const messages: Array<{ recipient: string; token: string }> = [], sockets = new Set<TLSSocket>();
const smtp = createTlsServer({ key: readFileSync(process.env.RPF_RECOVERY_TLS_KEY!), cert: readFileSync(process.env.RPF_RECOVERY_TLS_CERT!), minVersion: "TLSv1.2" }, socket => {
  smtpConnections++; sockets.add(socket); socket.setTimeout(5000, () => socket.destroy()); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
  assert.ok(["TLSv1.2", "TLSv1.3"].includes(socket.getProtocol()!));
  let buffer = "", data: string[] | null = null, authenticated = false, recipient = "", total = 0;
  socket.write("220 localhost synthetic recovery sink\r\n");
  socket.on("data", chunk => {
    total += chunk.length; if (total > 65536) { socket.destroy(); return; }
    buffer += chunk.toString("utf8"); let newline: number;
    while ((newline = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 2);
      if (data !== null) {
        if (line !== ".") { data.push(line); continue; }
        const text = data.join("\r\n").replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        assert.ok(text.includes("Reset your RepoProof password"));
        const match = /http:\/\/localhost:3000\/reset-password#token=([A-Za-z0-9]{24})/.exec(text); assert.ok(match);
        assert.ok(!text.includes(process.env.EMAIL_SENDER_SMTP_PASS!));
        messages.push({ recipient, token: match[1]! }); data = null; socket.write("250 queued locally\r\n");
      } else if (/^EHLO /i.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
      else if (/^AUTH PLAIN /i.test(line)) {
        assert.equal(Buffer.from(line.slice(11), "base64").toString("utf8"), `\0${process.env.EMAIL_SENDER_SMTP_USER}\0${process.env.EMAIL_SENDER_SMTP_PASS}`);
        authenticated = true; socket.write("235 authenticated\r\n");
      } else if (/^MAIL FROM:/i.test(line)) {
        assert.ok(authenticated); assert.equal(line.toLowerCase(), "mail from:<accounts@example.test>");
        socket.write(mailRejected ? "550 synthetic unavailable\r\n" : "250 sender accepted\r\n");
      } else if (/^RCPT TO:/i.test(line)) {
        assert.ok(authenticated); const match = /^RCPT TO:<([a-z0-9-]+@example\.test)>$/i.exec(line); assert.ok(match);
        recipient = match[1]!; socket.write("250 recipient accepted\r\n");
      } else if (line === "DATA") { assert.ok(recipient && authenticated); data = []; socket.write("354 send data\r\n"); }
      else if (line === "QUIT") socket.end("221 done\r\n");
      else if (line === "RSET") { data = null; socket.write("250 reset\r\n"); }
      else throw new Error("Unexpected synthetic SMTP command");
    }
  });
});
await new Promise<void>((resolve, reject) => { smtp.once("error", reject); smtp.listen(15443, "127.0.0.1", resolve); });
const { prisma } = await import("../src/lib/prisma");
const { default: app }: typeof import("../src/app") = bundled ? await import(new URL("../function-build/app.js", import.meta.url).href) : await import("../src/app");
const observer = new pg.Pool({ connectionString: "postgresql://rpf_test@127.0.0.1:35441/rpf_recovery_disposable", max: 1 });
const host = "127.0.0.1", origin = "http://localhost:3000", users: string[] = [];
const server = app.listen(0, host);
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://${host}:${(server.address() as AddressInfo).port}`;
// Each test uses a fresh synthetic client through a real loopback socket, then
// proves that client's native quota. Shared email/global buckets remain intact.
// No forwarded-IP header, stored quota deletion, time change or limit override.
const clientAddress = `127.17.${randomInt(1, 255)}.${randomInt(2, 255)}`;
const post = (path: string, body: unknown, cookie = "", sentOrigin: string | null = origin) => new Promise<Response>((resolve, reject) => {
  const request = httpRequest(new URL("/api/auth/" + path, base), { localAddress: clientAddress, method: "POST", headers: { "content-type": "application/json", cookie, ...(sentOrigin === null ? {} : { origin: sentOrigin }) } }, response => {
    const chunks: Buffer[] = [], headers = new Headers(); let bytes = 0;
    for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
    response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) response.destroy(new Error("Oversized recovery response")); else chunks.push(chunk); });
    response.on("error", reject); response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode!, headers })));
  });
  request.setTimeout(10000, () => request.destroy(new Error("Local recovery HTTP deadline"))); request.on("error", reject); request.end(JSON.stringify(body));
});
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
const session = async (cookie: string) => { const response = await fetch(base + "/api/auth/get-session", { headers: { cookie } }); assert.equal(response.status, 200); return response.json(); };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const message = async (index: number) => {
  const until = Date.now() + 8000;
  while (messages.length <= index && Date.now() < until) await pause(25);
  assert.ok(messages[index], "TLS sink did not receive the bounded recovery email"); return messages[index]!;
};
try {
  const counts = async () => (await observer.query('SELECT (SELECT count(*)::int FROM "Run") AS runs, (SELECT count(*)::int FROM "VerificationReport") AS reports, (SELECT count(*)::int FROM "Artifact") AS artifacts')).rows;
  const before = await counts(); assert.deepEqual(before, [{ runs: 0, reports: 0, artifacts: 0 }]);
  const identity = await prisma.$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`; assert.equal(identity[0]?.role, "rpf_recovery_runtime"); await assert.rejects(prisma.run.count());
  const capabilities = await fetch(base + "/api/v1/auth-capabilities"); assert.equal(capabilities.status, 200); assert.deepEqual(await capabilities.json(), { passwordReset: { enabled: true } }); assert.equal(capabilities.headers.get("cache-control"), "no-store");
  const email = `recovery-${randomUUID()}@example.test`, otherEmail = `other-${randomUUID()}@example.test`, password = "synthetic-original-password";
  const signup = async (address: string) => {
    const response = await post("sign-up/email", { name: "Synthetic recovery", email: address, password }); assert.equal(response.status, 200);
    const data = await response.json(); users.push(data.user.id); return { id: data.user.id as string, cookie: cookieOf(response) };
  };
  const a = await signup(email), b = await signup(otherEmail), device = await post("sign-in/email", { email, password }); assert.equal(device.status, 200);
  const known = await post("request-password-reset", { email }); assert.equal(known.status, 200); assert.equal(known.headers.get("cache-control"), "no-store");
  const first = await message(0); assert.equal(first.recipient, email);
  const hashed = createHash("sha256").update("reset-password:" + first.token).digest("base64url");
  const tokensBefore = (await observer.query('SELECT "identifier", "value", EXTRACT(EPOCH FROM (("expiresAt" AT TIME ZONE \'UTC\') - clock_timestamp())) * 1000 AS "remainingMs" FROM public."verification" WHERE "value"=$1', [a.id])).rows;
  assert.equal(tokensBefore.length, 1); assert.equal(tokensBefore[0].identifier, hashed); assert.ok(!JSON.stringify(tokensBefore).includes(first.token));
  // Prisma stores UTC timestamp-without-time-zone values. Evaluate the observer
  // delta in SQL, avoiding pg's host-local parser for that PostgreSQL type.
  const remaining = Number(tokensBefore[0].remainingMs); assert.ok(remaining > 880_000 && remaining <= 900_000);
  const nativeToken = await prisma.verification.findFirstOrThrow({ where: { identifier: hashed } });
  assert.ok(nativeToken.expiresAt.getTime() - Date.now() > 880_000);
  const accountBefore = (await observer.query('SELECT "password" FROM public."account" WHERE "userId"=$1 AND "providerId"=\'credential\'', [a.id])).rows;
  const sessionsBefore = await prisma.session.count({ where: { userId: a.id } }); assert.equal(sessionsBefore, 2);
  // Force a real SQL write failure after native single-use consumption and
  // revocation. Transaction rollback must restore all three facts for retry.
  await observer.query('REVOKE UPDATE ON public."account" FROM rpf_recovery_runtime');
  try {
    const failure = await post("reset-password", { token: first.token, newPassword: "must-not-commit-password" }); assert.equal(failure.status, 500);
    const text = await failure.text(); for (const forbidden of ["permission", "Prisma", email, first.token]) assert.ok(!text.includes(forbidden));
  }
  finally { await observer.query('GRANT UPDATE ON public."account" TO rpf_recovery_runtime'); }
  assert.equal(await prisma.verification.count({ where: { identifier: hashed } }), 1); assert.equal(await prisma.session.count({ where: { userId: a.id } }), sessionsBefore);
  assert.ok(JSON.stringify((await observer.query('SELECT "password" FROM public."account" WHERE "userId"=$1 AND "providerId"=\'credential\'', [a.id])).rows) === JSON.stringify(accountBefore));
  const replacement = "synthetic-replacement-password", changed = await post("reset-password", { token: first.token, newPassword: replacement });
  assert.equal(changed.status, 200); assert.deepEqual(await changed.json(), { status: true }); assert.equal(changed.headers.getSetCookie().some(value => value.includes("session_token=") && !value.includes("Max-Age=0")), false);
  assert.equal(await session(a.cookie), null); assert.equal(await session(cookieOf(device)), null); assert.equal((await session(b.cookie)).user.id, b.id);
  assert.equal((await fetch(base + "/api/v1/repositories", { headers: { cookie: a.cookie } })).status, 401);
  assert.equal((await post("reset-password", { token: first.token, newPassword: "replayed-password" })).status, 400);
  assert.equal((await post("sign-in/email", { email, password })).status, 401);
  assert.equal((await post("sign-in/email", { email, password: replacement })).status, 200);
  assert.equal((await post("reset-password", { token: "0".repeat(24), newPassword: "invalid-token-password" })).status, 400);
  const secondResponse = await post("request-password-reset", { email }); assert.equal(secondResponse.status, 200); const second = await message(1);
  await prisma.verification.updateMany({ where: { value: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await post("reset-password", { token: second.token, newPassword: "expired-password" })).status, 400);
  assert.equal((await post("request-password-reset", { email })).status, 200); const third = await message(2);
  const passwords = ["synthetic-concurrent-one", "synthetic-concurrent-two"], race = await Promise.all(passwords.map(newPassword => post("reset-password", { token: third.token, newPassword })));
  assert.deepEqual(race.map(response => response.status).sort(), [200, 400]); const winner = race[0]!.status === 200 ? 0 : 1;
  assert.equal((await post("sign-in/email", { email, password: passwords[winner] })).status, 200);
  assert.equal((await post("sign-in/email", { email, password: passwords[1 - winner] })).status, 401);
  const unknown = await post("request-password-reset", { email: `unknown-${randomUUID()}@example.test` }); assert.equal(unknown.status, 200); assert.deepEqual(await known.json(), await unknown.json());
  const limited = await post("request-password-reset", { email }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "900");
  // Actual shared per-IP native quota now blocks even a fresh unknown address.
  assert.equal((await post("request-password-reset", { email: `unknown-${randomUUID()}@example.test` })).status, 429);
  assert.equal((await post("reset-password", { token: "a".repeat(24), newPassword: "short" })).status, 400);
  assert.equal((await post("reset-password?token=" + "a".repeat(24), { newPassword: "synthetic-password" })).status, 400);
  assert.equal((await post("reset-password", { token: "a".repeat(24), newPassword: "synthetic-password" })).status, 400);
  assert.equal((await post("reset-password", { token: "a".repeat(24), newPassword: "synthetic-password" })).status, 429);
  assert.equal(messages.length, 3);
  const keys = (await observer.query('SELECT "key" FROM public."AuthRateBucket"')).rows; assert.ok(keys.length > 0 && keys.every(row => /^[0-9a-f]{64}$/.test(row.key)));
  for (const forbidden of [email, otherEmail, ...messages.map(item => item.token), process.env.EMAIL_SENDER_SMTP_PASS!]) assert.ok(!errors.join("\n").includes(forbidden), "Private recovery material reached logs");
  assert.ok(errors.length > 0 && errors.every(value => value === '{"event":"auth_error"}'), "Native auth printed an unredacted error");
  assert.equal(externalAttempts, 0); assert.deepEqual(await counts(), before); assert.ok(smtpConnections >= 3);
  // Delivery rejection is separately exercised directly through the real TLS
  // transport, without spending another native request or sending external mail.
  mailRejected = true; const { createPasswordMailer } = await import("../src/lib/passwordMail");
  await assert.rejects(createPasswordMailer({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "15443", SMTP_USER: process.env.EMAIL_SENDER_SMTP_USER!, SMTP_PASS: process.env.EMAIL_SENDER_SMTP_PASS!, SMTP_FROM: "accounts@example.test", SMTP_SECURE: true }, origin)(email, "a".repeat(24)));
  console.log(JSON.stringify({ result: "PASS", scope: "OWNED_LOCAL_POSTGRES_TLS_SMTP_PASSWORD_RECOVERY", backendMode: bundled ? "EXPORTED_FUNCTION_BUNDLE" : "SOURCE", syntheticClientAddress: clientAddress, limitedRuntimeRole: true, tlsMailCapturedLocally: 3, realAtomicRollback: true, concurrentSingleUse: true, fullSessionRevocation: true, crossUserIsolation: true, unknownAddressNonDisclosure: true, expiry: true, sharedSqlQuotas: true, logRedaction: true, productRows: before, externalEmail: 0, externalAttempts, modelCalls: 0, sandboxCalls: 0, fixtureExecutions: 0 }));
} finally {
  globalThis.fetch = nativeFetch; console.error = nativeError;
  try { for (const id of users) { await prisma.verification.deleteMany({ where: { value: id } }); await prisma.user.deleteMany({ where: { id } }); } }
  finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve, reject) => smtp.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect(); await observer.end();
  }
}
