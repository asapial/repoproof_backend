import { describe, expect, it, vi } from "vitest";
import { Router } from "express";
import type { AddressInfo } from "node:net";
import { createApp } from "../appFactory";
import { errorResponseSchema } from "../contracts/v1";
import { createRunHistoryRouter, historyLimiter } from "./history";
import { encodeHistoryCursor, type HistoryStore } from "./historyStore";

const empty = { scope: "OWNED_RUN_RECORDS" as const, summary: { total: 0, running: 0, awaitingApproval: 0, completed: 0, failed: 0, cancelled: 0, repositories: 0, submittedIssues: 0 }, runs: [], nextCursor: null };
async function withServer(test: (base: string, list: ReturnType<typeof vi.fn<HistoryStore["list"]>>, allow: ReturnType<typeof vi.fn>) => Promise<void>) {
  const list = vi.fn<HistoryStore["list"]>().mockResolvedValue(empty), allow = vi.fn(async () => true);
  const router = Router(); router.use(createRunHistoryRouter(async req => req.headers["x-test-user"] === "a" ? "server-owner-a" : null, { list }, allow));
  const server = createApp((_req, res) => { res.sendStatus(404); }, router, "http://localhost:3000", false).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try { await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/runs`, list, allow); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const headers = { "x-test-user": "a" };
describe("owner history HTTP boundary", () => {
  it("authenticates before quota or database access and uses no-store", async () => withServer(async (base, list, allow) => {
    const response = await fetch(base); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(errorResponseSchema.parse(await response.json()).error.code).toBe("UNAUTHENTICATED"); expect(list).not.toHaveBeenCalled(); expect(allow).not.toHaveBeenCalled();
  }));
  it("returns the actual empty store result for the server-resolved owner", async () => withServer(async (base, list, allow) => {
    const response = await fetch(base, { headers }); expect(response.status).toBe(200); expect(await response.json()).toEqual(empty);
    expect(list).toHaveBeenCalledWith("server-owner-a", 10, null); expect(allow).toHaveBeenCalledWith("server-owner-a");
  }));
  it.each(["?userId=b", "?limit=0", "?limit=26", "?limit=01", "?limit=2&limit=3", "?cursor=bad", "?cursor=%2F", "?cursor="])("rejects unsafe/ambiguous query %s before quota/store", async query => withServer(async (base, list, allow) => {
    const response = await fetch(base + query, { headers }); expect(response.status).toBe(400); expect(list).not.toHaveBeenCalled(); expect(allow).not.toHaveBeenCalled();
  }));
  it("validates a canonical cursor and bounded page size", async () => withServer(async (base, list) => {
    const before = { at: "2026-11-02T12:00:00.000Z", id: "run-z" }, cursor = encodeHistoryCursor(before);
    expect((await fetch(`${base}?limit=25&cursor=${cursor}`, { headers })).status).toBe(200);
    expect(list).toHaveBeenCalledWith("server-owner-a", 25, before);
  }));
  it("fails closed on shared throttling without querying history", async () => withServer(async (base, list, allow) => {
    allow.mockResolvedValue(false); const response = await fetch(base, { headers });
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60"); expect(list).not.toHaveBeenCalled();
  }));
  it("keeps database errors and unsupported verdict fields private", async () => withServer(async (base, list) => {
    list.mockRejectedValueOnce(new Error("PRIVATE-DATABASE-URL")); list.mockResolvedValueOnce({ ...empty, verdict: "VERIFIED" } as unknown as typeof empty);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(base, { headers }); expect(response.status).toBe(503);
      const data = await response.json(); expect(errorResponseSchema.parse(data).error.code).toBe("HISTORY_UNAVAILABLE"); expect(JSON.stringify(data)).not.toMatch(/PRIVATE|VERIFIED/);
    }
  }));
});
describe("shared history limiter", () => {
  it("bounds owner and global requests and denies unavailable storage", async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true }); const allow = historyLimiter({ consume });
    expect(await allow("owner-a")).toBe(true);
    expect(consume.mock.calls).toEqual([["history:user:owner-a", { window: 60, max: 60 }], ["history:global", { window: 60, max: 300 }]]);
    consume.mockClear().mockResolvedValueOnce({ allowed: false }); expect(await allow("owner-b")).toBe(false); expect(consume).toHaveBeenCalledTimes(1);
    consume.mockRejectedValueOnce(new Error("private")); expect(await allow("owner-c")).toBe(false);
  });
});
