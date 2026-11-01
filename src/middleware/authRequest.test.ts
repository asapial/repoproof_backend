import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { authRequestGuards } from "./authRequest";

afterEach(() => vi.restoreAllMocks());
async function check(vercel: boolean, test: (base: string) => Promise<void>) {
  const app = express();
  app.use(...authRequestGuards(vercel, 50));
  app.use((req, res) => res.json({ ip: req.headers["x-repoproof-client-ip"], body: req.body }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try { await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
it("ignores spoofed forwarded/internal headers off Vercel and preserves parsed JSON", async () => check(false, async base => {
  const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-repoproof-client-ip": "1.2.3.4", "x-forwarded-for": "1.2.3.4", "x-vercel-forwarded-for": "1.2.3.4" }, body: '{"name":"owned"}' });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ip: "127.0.0.1", body: { name: "owned" } }); expect(response.headers.get("cache-control")).toBe("no-store");
}));
it("accepts only the single platform IP on Vercel and fails closed without it", async () => check(true, async base => {
  for (const ip of [undefined, "bad", "192.0.2.1, 192.0.2.2"]) {
    const response = await fetch(base, { headers: ip ? { "x-vercel-forwarded-for": ip } : {} }); expect(response.status).toBe(503);
  }
  const good = await fetch(base, { headers: { "x-vercel-forwarded-for": "2001:db8::1", "x-repoproof-client-ip": "evil" } });
  expect((await good.json()).ip).toBe("2001:db8::1");
}));
it("rejects unsupported/compressed bodies, primitive/malformed JSON and oversized length safely", async () => check(false, async base => {
  for (const [headers, body, status] of [
    [{ "content-type": "text/plain" }, "secret", 415],
    [{ "content-type": "application/json", "content-encoding": "gzip" }, "secret", 415],
    [{ "content-type": "application/json" }, "{secret", 400],
    [{ "content-type": "application/json" }, "42", 400],
    [{ "content-type": "application/json" }, JSON.stringify({ private: "x".repeat(17000) }), 413],
  ] as const) {
    const response = await fetch(base, { method: "POST", headers, body });
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("secret");
  }
}));
it("rejects chunked overflow without relying on Content-Length", async () => check(false, async base => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(base, { method: "POST", headers: { "content-type": "application/json" } }, res => { resolve(res.statusCode!); res.resume(); });
    req.on("error", reject); req.write('{"private":"'); req.write("x".repeat(17000)); req.end('"}');
  });
  expect(status).toBe(413);
}));
it("bounds a stalled chunked upload before authentication", async () => check(false, async base => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(base, { method: "POST", headers: { "content-type": "application/json" } }, res => { resolve(res.statusCode!); res.resume(); });
    req.on("error", reject); req.write('{"private":"');
  });
  expect(status).toBe(408);
}));
