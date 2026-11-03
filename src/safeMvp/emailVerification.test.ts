import { describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createEmailVerificationToken, isAPIError } from "better-auth/api";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import type { AddressInfo } from "node:net";
import { createApp } from "../appFactory";
import { authSecurityOptions } from "../lib/authSecurity";
import { authFailureBoundary } from "../lib/authHttp";
import { emailVerificationOptions } from "../lib/emailVerification";
import { validateVerificationToken } from "../lib/emailVerificationToken";
import { createEmailVerificationRouter, emailVerificationLimiter } from "./emailVerification";
import { createAuthCapabilitiesRouter } from "./authCapabilities";
import { errorResponseSchema } from "../contracts/v1";
import type { Request } from "express";

const secret = "synthetic-verification-memory-secret-0123456789", origin = "http://localhost:3000", password = "synthetic-password-123";
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
async function withServer(run: (h: {
  base: string; mail: Array<{ email: string; token: string }>; storage: { consume: ReturnType<typeof vi.fn> };
  deps: { allow: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn>; userFor: ReturnType<typeof vi.fn> };
  post: (path: string, body: unknown, cookie?: string, sentOrigin?: string | null) => Promise<Response>;
}) => Promise<void>, enabled = true) {
  const mail: Array<{ email: string; token: string }> = [], storage = { consume: vi.fn(async () => ({ allowed: true })) };
  const auth = betterAuth({ ...authSecurityOptions(origin, false), ...emailVerificationOptions(enabled, secret, async (email, token) => { mail.push({ email, token }); }, storage),
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }), secret, baseURL: "http://localhost:5000", rateLimit: { enabled: false }, logger: { level: "error", log: () => {} }, onAPIError: { throw: true } });
  const deps = {
    allow: vi.fn(emailVerificationLimiter(storage)),
    userFor: vi.fn(async (req: Request) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }); return session?.user ? { id: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified } : null;
    }),
    request: vi.fn(async (user: { email: string }, req: Request) => { await auth.api.sendVerificationEmail({ headers: fromNodeHeaders(req.headers), body: { email: user.email } }); }),
    confirm: vi.fn(async (token: string) => {
      try { validateVerificationToken(token, secret); } catch { return false; }
      try { return (await auth.api.verifyEmail({ query: { token } }))?.status === true; } catch (error) { if (isAPIError(error) && error.status === "UNAUTHORIZED") return false; throw error; }
    }),
  };
  const router = createEmailVerificationRouter({ enabled, frontendOrigin: origin, ...deps }); router.use(createAuthCapabilitiesRouter(true));
  const server = createApp(authFailureBoundary(toNodeHandler(auth)), router, origin, false).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, cookie = "", sentOrigin: string | null = origin) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie, ...(sentOrigin === null ? {} : { origin: sentOrigin }) }, body: JSON.stringify(body) });
  try { await run({ base, mail, storage, deps, post }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await response.json(); expect(errorResponseSchema.safeParse(body).success).toBe(true); expect(body.error.code).toBe(code); expect(JSON.stringify(body)).not.toContain("PRIVATE");
}
describe("owned verification JSON routes with genuine native auth and synthetic memory data", () => {
  it("publishes independent capability and current-owner state; resends only to that owner", async () => withServer(async h => {
    expect(await (await fetch(h.base + "/api/v1/auth-capabilities")).json()).toEqual({ passwordReset: { enabled: true } });
    expect(await (await fetch(h.base + "/api/v1/email-verification")).json()).toEqual({ enabled: true });
    const a = await h.post("/api/auth/sign-up/email", { name: "A", email: "a@example.test", password }); expect(a.status).toBe(200); expect(h.mail).toHaveLength(1);
    // Profile updates cannot self-assert the new ownership state.
    const forged = await h.post("/api/auth/update-user", { name: "A profile", emailVerified: true }, cookies(a));
    expect([200, 400, 403]).toContain(forged.status);
    const cookie = cookies(a), status = await fetch(h.base + "/api/v1/email-verification/account", { headers: { cookie } });
    expect(status.headers.get("cache-control")).toBe("no-store"); expect(await status.json()).toEqual({ email: "a@example.test", verified: false, enabled: true });
    await error(await h.post("/api/v1/email-verification/request", { email: "b@example.test" }, cookie), 400, "INVALID_INPUT");
    await error(await h.post("/api/v1/email-verification/request", {}), 401, "UNAUTHENTICATED");
    expect((await h.post("/api/v1/email-verification/request", {}, cookie)).status).toBe(202); expect(h.mail).toHaveLength(2); expect(h.mail.every(item => item.email === "a@example.test")).toBe(true);
  }));
  it("confirms only the linked email, idempotently, without auto-login, email change or unrelated-user effects", async () => withServer(async h => {
    const a = await h.post("/api/auth/sign-up/email", { name: "A", email: "a@example.test", password }), b = await h.post("/api/auth/sign-up/email", { name: "B", email: "b@example.test", password });
    expect(a.status).toBe(200); expect(b.status).toBe(200); const aCookie = cookies(a), bCookie = cookies(b), token = h.mail[0]!.token;
    for (let count = 0; count < 2; count++) { const confirmed = await h.post("/api/v1/email-verification/confirm", { token }, bCookie); expect(confirmed.status).toBe(200); expect(await confirmed.json()).toEqual({ status: true }); expect(confirmed.headers.getSetCookie()).toEqual([]); }
    expect(await (await fetch(h.base + "/api/v1/email-verification/account", { headers: { cookie: aCookie } })).json()).toEqual({ email: "a@example.test", verified: true, enabled: true });
    expect(await (await fetch(h.base + "/api/v1/email-verification/account", { headers: { cookie: bCookie } })).json()).toEqual({ email: "b@example.test", verified: false, enabled: true });
    const before = h.mail.length; expect((await h.post("/api/v1/email-verification/request", {}, aCookie)).status).toBe(202); expect(h.mail).toHaveLength(before);
    expect((await fetch(h.base + "/api/auth/get-session").then(response => response.json())) === null).toBe(true);
    for (const path of ["/api/auth/verify-email", "/api/auth/verify-email/"]) expect((await fetch(h.base + path + "?token=" + token, { redirect: "manual" })).status).toBe(404);
    expect((await h.post("/api/auth/send-verification-email", { email: "b@example.test" }, bCookie)).status).toBe(404);
  }));
  it("rejects raw native tokens, bad origin/query/body/transport and limits before any confirmation", async () => withServer(async h => {
    const raw = await createEmailVerificationToken(secret, "a@example.test", undefined, 900);
    await error(await h.post("/api/v1/email-verification/confirm", { token: raw }), 400, "EMAIL_VERIFICATION_LINK_INVALID");
    for (const sentOrigin of [null, "https://evil.example"]) await error(await h.post("/api/v1/email-verification/confirm", { token: raw }, "", sentOrigin), 403, sentOrigin === null ? "ORIGIN_REQUIRED" : "ORIGIN_NOT_ALLOWED");
    await error(await h.post("/api/v1/email-verification/confirm?token=PRIVATE", { token: raw }), 400, "INVALID_INPUT");
    await error(await h.post("/api/v1/email-verification/confirm", { token: raw, owner: "other" }), 400, "INVALID_INPUT");
    await error(await fetch(h.base + "/api/v1/email-verification/confirm", { method: "POST", headers: { origin, "content-type": "text/plain" }, body: "PRIVATE" }), 415, "UNSUPPORTED_MEDIA_TYPE");
    await error(await fetch(h.base + "/api/v1/email-verification/confirm", { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"PRIVATE":' }), 400, "INVALID_INPUT");
    await error(await h.post("/api/v1/email-verification/confirm", { token: "x".repeat(17000) }), 413, "PAYLOAD_TOO_LARGE");
    h.deps.allow.mockResolvedValue(false); await error(await h.post("/api/v1/email-verification/confirm", { token: raw }), 429, "EMAIL_VERIFICATION_RATE_LIMITED");
  }));
  it("distinguishes invalid links from storage/delivery failures and denies revoked sessions", async () => withServer(async h => {
    const a = await h.post("/api/auth/sign-up/email", { name: "A", email: "a@example.test", password }); expect(a.status).toBe(200); const cookie = cookies(a), token = h.mail[0]!.token;
    h.deps.confirm.mockRejectedValue(new Error("PRIVATE database")); await error(await h.post("/api/v1/email-verification/confirm", { token }), 503, "EMAIL_VERIFICATION_UNAVAILABLE");
    h.storage.consume.mockResolvedValue({ allowed: false }); h.deps.allow.mockResolvedValue(true);
    await error(await h.post("/api/v1/email-verification/request", {}, cookie), 429, "EMAIL_VERIFICATION_RATE_LIMITED");
    expect((await h.post("/api/auth/sign-out", {}, cookie)).status).toBe(200);
    await error(await fetch(h.base + "/api/v1/email-verification/account", { headers: { cookie } }), 401, "UNAUTHENTICATED");
    await error(await h.post("/api/v1/email-verification/request", {}, cookie), 401, "UNAUTHENTICATED");
  }));
  it("keeps default-disabled mail and existing authentication/recovery capability compatible", async () => withServer(async h => {
    const a = await h.post("/api/auth/sign-up/email", { name: "A", email: "a@example.test", password }); expect(a.status).toBe(200); expect(h.mail).toHaveLength(0);
    expect(await (await fetch(h.base + "/api/v1/email-verification")).json()).toEqual({ enabled: false });
    expect(await (await fetch(h.base + "/api/v1/auth-capabilities")).json()).toEqual({ passwordReset: { enabled: true } });
    await error(await h.post("/api/v1/email-verification/request", {}, cookies(a)), 503, "EMAIL_VERIFICATION_UNAVAILABLE");
    await error(await h.post("/api/v1/email-verification/confirm", { token: await createEmailVerificationToken(secret, "a@example.test", undefined, 900) }), 503, "EMAIL_VERIFICATION_UNAVAILABLE");
    expect((await h.post("/api/auth/sign-in/email", { email: "a@example.test", password })).status).toBe(200);
  }, false));
});
