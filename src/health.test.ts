import { expect, it, vi } from "vitest";
import { Router } from "express";
import type { AddressInfo } from "node:net";
import { createApp } from "./appFactory";

async function check(readiness: (() => Promise<unknown>) | undefined, test: (base: string) => Promise<void>) {
  const app = createApp(() => { throw new Error("private database credential"); }, Router(), "http://localhost:3000", false, undefined, { ...(readiness ? { checkReadiness: readiness } : {}), readinessTimeoutMs: 20 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try { await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
it("distinguishes liveness from database readiness without exposing internals", async () => {
  const ready = vi.fn().mockResolvedValue(1);
  await check(ready, async base => {
    const live = await fetch(`${base}/healthz`); expect(await live.json()).toEqual({ status: "ok" }); expect(ready).not.toHaveBeenCalled();
    const response = await fetch(`${base}/readyz`); expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ready" }); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-powered-by")).toBeNull();
  });
});
it("fails readiness closed for missing, failed and stalled database checks", async () => {
  for (const readiness of [undefined, () => Promise.reject(new Error("private credential")), () => new Promise(() => {})]) {
    await check(readiness, async base => {
      const response = await fetch(`${base}/readyz`); expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: "unavailable" });
    });
  }
});
it("completes unexpected auth failures with safe JSON", async () => check(undefined, async base => {
  const response = await fetch(`${base}/api/auth/test`); expect(response.status).toBe(500); expect(await response.json()).toEqual({ message: "Internal server error" });
}));
