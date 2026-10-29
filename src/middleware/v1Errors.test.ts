import { describe, expect, it } from "vitest";
import { Router } from "express";
import type { AddressInfo } from "node:net";
import { createApp } from "../appFactory";
import { createRunRequestSchema, errorResponseSchema } from "../contracts/v1";
import { validateV1Body } from "./v1Errors";

async function withServer(test: (url: string) => Promise<void>) {
  const router = Router();
  // Test-only endpoints; no business routes are registered by this change.
  router.post("/validation", validateV1Body(createRunRequestSchema), (_req, res) => res.json({ ok: true }));
  router.get("/failure", () => { throw new Error("private diagnostic"); });
  const app = createApp((_req, res) => res.status(418).json({ message: "auth unchanged" }), router, "http://localhost:3000", false);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try { await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

describe("v1 error envelope on real HTTP middleware", () => {
  it("validates body and returns a safe contract error for invalid input", async () => withServer(async base => {
    const post = (body: string) => fetch(`${base}/api/v1/validation`, { method: "POST", headers: { "content-type": "application/json" }, body });
    expect((await post(JSON.stringify({ repositoryId: "repo", issueNumber: 1, fixtureKey: "fixture" }))).status).toBe(200);
    const response = await post(JSON.stringify({ repositoryId: "repo", issueNumber: 0, fixtureKey: "secret-value" }));
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(errorResponseSchema.parse(body).error.code).toBe("INVALID_INPUT");
    expect(JSON.stringify(body)).not.toContain("secret-value");
    const malformed = await post('{"secret":"value"');
    expect(malformed.status).toBe(400);
    const result: unknown = await malformed.json();
    expect(errorResponseSchema.parse(result).error.code).toBe("INVALID_JSON");
    expect(JSON.stringify(result)).not.toContain("secret");
    const large = await post(JSON.stringify({ data: "x".repeat(110_000) }));
    expect(large.status).toBe(413);
    expect(errorResponseSchema.parse(await large.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
  }));
  it("envelopes origin failures, csrf failures and unexpected errors without changing auth", async () => withServer(async base => {
    const denied = await fetch(`${base}/api/v1/validation`, { method: "POST", headers: { origin: "https://evil.example" } });
    expect(denied.status).toBe(403);
    const deniedBody = errorResponseSchema.parse(await denied.json());
    expect(deniedBody.error.code).toBe("ORIGIN_NOT_ALLOWED");
    const csrf = await fetch(`${base}/api/v1/validation`, { method: "POST", headers: { cookie: "session=secret" } });
    expect(csrf.status).toBe(403);
    expect(errorResponseSchema.parse(await csrf.json()).error.code).toBe("ORIGIN_REQUIRED");
    const missing = await fetch(`${base}/api/v1/does-not-exist`);
    expect(missing.status).toBe(404);
    expect(errorResponseSchema.parse(await missing.json()).error.code).toBe("NOT_FOUND");
    const failure = await fetch(`${base}/api/v1/failure`);
    expect(failure.status).toBe(500);
    const failureBody = errorResponseSchema.parse(await failure.json());
    expect(failureBody.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(failureBody)).not.toContain("private diagnostic");
    expect(failureBody.error.requestId).not.toBe(deniedBody.error.requestId);
    const legacy = await fetch(`${base}/api/auth/example`, { headers: { origin: "https://evil.example" } });
    expect(await legacy.json()).toEqual({ message: "Origin not allowed" });
  }));
});
