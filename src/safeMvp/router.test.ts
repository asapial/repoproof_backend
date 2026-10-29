import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { createApp } from "../appFactory";
import { authSecurityOptions } from "../lib/authSecurity";
import { errorResponseSchema } from "../contracts/v1";
import { createSafeMvpRouter, publicCatalogSchema } from "./router";

const origin = "http://localhost:3000";
async function withServer(test: (base: string, cookie: string) => Promise<void>) {
  const auth = betterAuth({ ...authSecurityOptions(origin, false), baseURL: "http://localhost:3001", secret: "test-only-secret-with-at-least-32-characters" });
  const router = createSafeMvpRouter(async req => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    return Boolean(session?.user?.id);
  });
  const server = createApp(toNodeHandler(auth), router, origin, false, "http://localhost:3001").listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Test", email: "safe-mvp@example.test", password: "not-a-real-secret-123" }) });
    expect(signup.status).toBe(200);
    const cookie = signup.headers.getSetCookie().find(c => c.startsWith("better-auth.session_token="))?.split(";")[0];
    expect(cookie).toBeTruthy();
    await test(base, cookie!);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const run = { repositoryId: "repoproof-backend", issueNumber: 1, fixtureKey: "discount-bug" };
describe("runner-free API", () => {
  it("requires a real session and returns only public curated fixture data", async () => withServer(async (base, cookie) => {
    const unauthorized = await fetch(`${base}/api/v1/repositories`);
    expect(unauthorized.status).toBe(401);
    expect(errorResponseSchema.parse(await unauthorized.json()).error.code).toBe("UNAUTHENTICATED");
    const response = await fetch(`${base}/api/v1/repositories`, { headers: { cookie, origin } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await response.json();
    const catalog = publicCatalogSchema.parse(body);
    expect(catalog.repositories).toEqual([{ repositoryId: "repoproof-backend", repository: "asapial/repoproof_backend", fixtureKey: "discount-bug", issueNumber: 1, source: "CURATED" }]);
    const manifest = JSON.parse(readFileSync(new URL("../../fixtures/discount-bug/manifest.json", import.meta.url), "utf8")) as { fixtureKey: string; issue: { url: string } };
    const source = new URL(manifest.issue.url);
    const [owner, repo, issues, number] = source.pathname.split("/").filter(Boolean);
    expect(source.hostname).toBe("github.com"); expect(issues).toBe("issues");
    expect(catalog.repositories[0]).toMatchObject({ repository: `${owner}/${repo}`, fixtureKey: manifest.fixtureKey, issueNumber: Number(number) });
    expect(JSON.stringify(body)).not.toMatch(/command|path|token|patch|sha256/i);
    expect(publicCatalogSchema.safeParse({ repositories: [{ ...catalog.repositories[0], secret: "x" }] }).success).toBe(false);
  }));
  it("rejects unauthorized or invalid requests and fails closed for approved fixtures", async () => withServer(async (base, cookie) => {
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/v1/runs`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await post(run)).status).toBe(401);
    expect((await post(run, { cookie })).status).toBe(403);
    const headers = { cookie, origin };
    const invalid = await post({ ...run, issueNumber: 0 }, headers);
    expect(invalid.status).toBe(400);
    expect(errorResponseSchema.parse(await invalid.json()).error.code).toBe("INVALID_INPUT");
    const unapproved = await post({ ...run, fixtureKey: "not-approved" }, headers);
    expect(unapproved.status).toBe(404);
    expect(errorResponseSchema.parse(await unapproved.json()).error.code).toBe("NOT_FOUND");
    const unavailable = await post(run, headers);
    expect(unavailable.status).toBe(503);
    const body = errorResponseSchema.parse(await unavailable.json());
    expect(body.error.code).toBe("RUNNER_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toMatch(/VERIFIED|runId|verdict|token|secret/);
    expect((await post(run, { cookie, origin: "https://evil.example" })).status).toBe(403);
  }));
  it("fails closed on malformed or duplicate catalog configuration", () => {
    expect(() => createSafeMvpRouter(async () => true, [{ repositoryId: "repo", repository: "private", fixtureKey: "foo", issueNumber: -1, source: "CURATED" }])).toThrow();
    const entry = { repositoryId: "repo", repository: "owner/repo", fixtureKey: "foo", issueNumber: 1, source: "CURATED" };
    expect(() => createSafeMvpRouter(async () => true, [entry, entry])).toThrow();
    expect(() => createSafeMvpRouter(async () => true, [{ ...entry, command: "not allowed" }])).toThrow();
  });
});
