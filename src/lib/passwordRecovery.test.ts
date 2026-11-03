import { describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import type { AddressInfo } from "node:net";
import { createApp } from "../appFactory";
import { authSecurityOptions } from "./authSecurity";
import { passwordRecoveryOptions } from "./passwordRecovery";
import { createAuthCapabilitiesRouter } from "../safeMvp/authCapabilities";

const origin = "http://localhost:3000", email = "recovery@example.test", password = "synthetic-original-password";
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
async function withAuth(run: (context: {
  base: string; mail: Array<{ email: string; token: string }>;
  post: (path: string, body: unknown, cookie?: string, sentOrigin?: string | null) => Promise<Response>;
  records: { user: unknown[]; session: unknown[]; account: unknown[]; verification: unknown[] }; storage: { consume: ReturnType<typeof vi.fn> };
}) => Promise<void>, enabled = true) {
  const records = { user: [], session: [], account: [], verification: [] }, mail: Array<{ email: string; token: string }> = [];
  const storage = { consume: vi.fn(async () => ({ allowed: true })) };
  const auth = betterAuth({ ...authSecurityOptions(origin, false),
    ...passwordRecoveryOptions(origin, enabled ? async (email, token) => { mail.push({ email, token }); } : null, storage),
    database: memoryAdapter(records), secret: "synthetic-reset-only-secret-01234567890123456789", baseURL: "http://localhost:5000",
    logger: { level: "error", log: () => {} }, rateLimit: { enabled: false } });
  const server = createApp(toNodeHandler(auth), createAuthCapabilitiesRouter(enabled), origin, false).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, cookie = "", sentOrigin: string | null = origin) => fetch(base + "/api/auth/" + path, { method: "POST", headers: { "content-type": "application/json", cookie, ...(sentOrigin === null ? {} : { origin: sentOrigin }) }, body: JSON.stringify(body) });
  try { await run({ base, mail, post, records, storage }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

describe("native password recovery with synthetic memory data", () => {
  it("returns the same response for existing and unknown addresses and stores only a hashed expiring identifier", async () => withAuth(async h => {
    expect((await h.post("sign-up/email", { email, password, name: "Synthetic recovery" })).status).toBe(200);
    const known = await h.post("request-password-reset", { email }), unknown = await h.post("request-password-reset", { email: "missing@example.test" });
    expect(known.status).toBe(200); expect(unknown.status).toBe(200); expect(await known.json()).toEqual(await unknown.json());
    expect(h.mail).toHaveLength(1); expect(h.mail[0]!.email).toBe(email); expect(h.mail[0]!.token).toMatch(/^[A-Za-z0-9]{24}$/);
    const stored = JSON.stringify(h.records.verification); expect(stored).not.toContain(h.mail[0]!.token); expect(stored).not.toContain("reset-password:");
    const record = h.records.verification[0] as { expiresAt: Date }; const remaining = record.expiresAt.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(890_000); expect(remaining).toBeLessThanOrEqual(900_000);
    expect(h.storage.consume).toHaveBeenCalledWith(`password-recovery:email:${email}`, { window: 900, max: 3 });
    expect(h.storage.consume).toHaveBeenCalledWith("password-recovery:email:missing@example.test", { window: 900, max: 3 });
    expect(known.headers.get("cache-control")).toBe("no-store");
  }));
  it("uses one token once, revokes every device, preserves another owner and requires a new login", async () => withAuth(async h => {
    const first = await h.post("sign-up/email", { email, password, name: "A" }), device = await h.post("sign-in/email", { email, password });
    const other = await h.post("sign-up/email", { email: "other@example.test", password, name: "B" });
    const get = (cookie: string) => fetch(h.base + "/api/auth/get-session", { headers: { cookie } });
    expect((await h.post("request-password-reset", { email })).status).toBe(200);
    const token = h.mail[0]!.token, replacement = "synthetic-replacement-password";
    const changed = await h.post("reset-password", { token, newPassword: replacement });
    expect(changed.status).toBe(200); expect(await changed.json()).toEqual({ status: true }); expect(changed.headers.getSetCookie().some(value => value.includes("session_token=") && !value.includes("Max-Age=0"))).toBe(false);
    expect((await h.post("reset-password", { token, newPassword: "another-password" })).status).toBe(400);
    for (const response of [first, device]) expect(await (await get(cookies(response))).json()).toBeNull();
    expect((await (await get(cookies(other))).json()).user.email).toBe("other@example.test");
    expect((await h.post("sign-in/email", { email, password })).status).toBe(401);
    expect((await h.post("sign-in/email", { email, password: replacement })).status).toBe(200);
  }));
  it("rejects invalid, expired and concurrently replayed tokens without accepting the losing password", async () => withAuth(async h => {
    expect((await h.post("sign-up/email", { email, password, name: "A" })).status).toBe(200);
    expect((await h.post("request-password-reset", { email })).status).toBe(200);
    const expired = h.mail[0]!.token;
    for (const record of h.records.verification as Array<{ expiresAt: Date }>) record.expiresAt = new Date(Date.now() - 1000);
    expect((await h.post("reset-password", { token: expired, newPassword: "expired-password" })).status).toBe(400);
    expect((await h.post("reset-password", { token: "0".repeat(24), newPassword: "invalid-password" })).status).toBe(400);
    expect((await h.post("request-password-reset", { email })).status).toBe(200);
    const token = h.mail[1]!.token;
    const attempts = await Promise.all(["winner-one-password", "winner-two-password"].map(newPassword => h.post("reset-password", { token, newPassword })));
    expect(attempts.map(response => response.status).sort()).toEqual([200, 400]);
    const winner = attempts[0]!.status === 200 ? 0 : 1;
    expect((await h.post("sign-in/email", { email, password: ["winner-one-password", "winner-two-password"][winner] })).status).toBe(200);
    expect((await h.post("sign-in/email", { email, password: ["winner-one-password", "winner-two-password"][1 - winner] })).status).toBe(401);
  }));
  it("rejects origin, redirect, query-token and malformed-password attacks before delivery or mutation", async () => withAuth(async h => {
    expect((await h.post("sign-up/email", { email, password, name: "A" })).status).toBe(200);
    for (const redirectTo of ["https://evil.example/reset-password", "//evil.example", origin + "/workspace", origin + "/reset-password?next=evil"]) {
      expect((await h.post("request-password-reset", { email, redirectTo })).status).toBe(redirectTo.startsWith(origin) ? 400 : 403);
    }
    for (const sentOrigin of [null, "https://evil.example"]) expect((await h.post("request-password-reset", { email }, "", sentOrigin)).status).toBe(403);
    expect(h.mail).toHaveLength(0);
    expect((await h.post("request-password-reset", { email, redirectTo: origin + "/reset-password" })).status).toBe(200);
    const token = h.mail[0]!.token;
    for (const newPassword of ["short", "x".repeat(129)]) expect((await h.post("reset-password", { token, newPassword })).status).toBe(400);
    expect((await h.post("reset-password?token=" + token, { newPassword: "valid-password" })).status).toBe(400);
    const redirected = await fetch(h.base + "/api/auth/reset-password/" + token + "?callbackURL=" + encodeURIComponent(origin + "/workspace"), { redirect: "manual" });
    expect(redirected.status).toBe(400); expect(redirected.headers.get("location")).toBeNull();
    expect((await h.post("sign-in/email", { email, password })).status).toBe(200);
  }));
  it("fails closed for shared limits and storage failures without delivering mail", async () => withAuth(async h => {
    h.storage.consume.mockResolvedValue({ allowed: false });
    const limited = await h.post("request-password-reset", { email }); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("900");
    h.storage.consume.mockRejectedValue(new Error("private-database-details"));
    const failure = await h.post("request-password-reset", { email }); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain("private-database-details"); expect(h.mail).toHaveLength(0);
  }));
  it("publishes only configuration capability and disables request, completion and callback when mail is off", async () => withAuth(async h => {
    const config = await fetch(h.base + "/api/v1/auth-capabilities"); expect(config.status).toBe(200); expect(await config.json()).toEqual({ passwordReset: { enabled: false } }); expect(config.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(h.base + "/api/v1/auth-capabilities?email=private")).status).toBe(400);
    expect((await h.post("request-password-reset", { email })).status).toBe(503);
    expect((await h.post("reset-password", { token: "a".repeat(24), newPassword: "synthetic-password" })).status).toBe(503);
    expect((await fetch(h.base + "/api/auth/reset-password/" + "a".repeat(24) + "?callbackURL=" + encodeURIComponent(origin + "/reset-password"), { redirect: "manual" })).status).toBe(503);
    expect(h.storage.consume).not.toHaveBeenCalled(); expect(h.mail).toHaveLength(0);
  }, false));
});
