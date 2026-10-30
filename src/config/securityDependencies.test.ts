import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { request } from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { Router } from "express";
import { createApp } from "../appFactory";

const proxy = createRequire(import.meta.url)("proxy-addr") as { compile: (subnet: string) => (address: string, index: number) => boolean };

describe("dependency security regressions", () => {
  it("does not trust arbitrary IPv4 clients for a short IPv4-mapped IPv6 subnet", () => {
    const invalidMapped = proxy.compile("::ffff:10.0.0.0/8");
    expect(invalidMapped("192.168.1.1", 0)).toBe(false);
    const validMapped = proxy.compile("::ffff:10.0.0.0/104");
    expect(validMapped("10.2.3.4", 0)).toBe(true);
    expect(validMapped("192.168.1.1", 0)).toBe(false);
  });
  it("keeps serving requests after a compressed body with trailing invalid bytes", async () => {
    const router = Router();
    router.post("/test", (_req, res) => res.json({ ok: true }));
    const server = createApp((_req, res) => res.sendStatus(404), router, "http://localhost:3000", false).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const port = (server.address() as AddressInfo).port;
    try {
      const payload = Buffer.concat([gzipSync(Buffer.from('{}')), Buffer.from([0xff, 0xff])]);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ hostname: "127.0.0.1", port, path: "/api/v1/test", method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": payload.length } }, res => { res.resume(); res.once("end", () => resolve(res.statusCode ?? 0)); });
        req.once("error", reject); req.end(payload);
      });
      expect([200, 400, 500]).toContain(status);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
