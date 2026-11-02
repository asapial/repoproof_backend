import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createApp } from "../appFactory";
import { issuePreviewSchema } from "../contracts/issuePreview";
import { errorResponseSchema } from "../contracts/v1";
import { createIssuePreviewRouter } from "./issues";

const origin = "http://localhost:3000", path = "/api/v1/repositories/repoproof-backend/issues";
const preview = () => ({ baseSha: "1066351c5b07bed024775a16af9151048a9316b2",
  issue: { number: 1, title: "Owned issue", body: "<script>untrusted()</script>", url: "https://github.com/asapial/repoproof_backend/issues/1" } });
async function withServer(test: (h: { base: string; allow: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> }) => Promise<void>, authenticated = true) {
  const allow = vi.fn(async () => true), load = vi.fn(async (_signal: AbortSignal) => { void _signal; return preview(); });
  const router = createIssuePreviewRouter(async () => authenticated ? "owned-user" : null, { allow, load });
  const server = createApp((_req, res) => { res.status(404).json({}); }, router, origin, false).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try { await test({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, allow, load }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
describe("owned issue-preview route — synthetic session/transport dependencies", () => {
  it("returns bounded public metadata with no run or verification facts", async () => withServer(async h => {
    const response = await fetch(h.base+path);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const body = issuePreviewSchema.parse(await response.json());
    expect(body.issues).toEqual([preview().issue]); expect(body.source).toBe("GITHUB_API");
    expect(h.allow).toHaveBeenCalledWith("owned-user"); expect(h.load.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(body)).not.toMatch(/runId|verdict|authentic|storageKey|token|secret/);
  }));
  it("denies missing session before rate storage or GitHub", async () => withServer(async h => {
    const response = await fetch(h.base+path); expect(response.status).toBe(401);
    expect(errorResponseSchema.parse(await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(h.allow).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled();
  },false));
  it("rejects unapproved IDs, query instructions and evil origins before upstream access", async () => withServer(async h => {
    for (const url of [path.replace("repoproof-backend","other"), path.replace("repoproof-backend","..%2Fother")]) expect((await fetch(h.base+url)).status).toBe(404);
    for (const query of ["?issue=2", "?url=https://evil.invalid", "?a[b]=x"]) expect((await fetch(h.base+path+query)).status).toBe(400);
    expect((await fetch(h.base+path,{ headers: { origin: "https://evil.invalid" } })).status).toBe(403);
    expect(h.allow).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled();
  }));
  it("returns a bounded retry instruction and performs zero upstream work at quota", async () => withServer(async h => {
    h.allow.mockResolvedValue(false);
    const response = await fetch(h.base+path); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("900");
    expect(errorResponseSchema.parse(await response.json()).error.code).toBe("RATE_LIMITED"); expect(h.load).not.toHaveBeenCalled();
  }));
  it("redacts upstream failures and refuses malformed or extended source metadata", async () => withServer(async h => {
    h.load.mockRejectedValueOnce(new Error("SENSITIVE https://token@private.invalid"));
    for (const invalid of [{ ...preview(), baseSha: "0".repeat(40) }, { ...preview(), issue: { ...preview().issue, secret: "SENSITIVE" } }]) h.load.mockResolvedValueOnce(invalid);
    for (let i=0; i<3; i++) {
      const response = await fetch(h.base+path); expect(response.status).toBe(503);
      const body = errorResponseSchema.parse(await response.json()); expect(body.error.code).toBe("SOURCE_UNAVAILABLE");
      expect(JSON.stringify(body)).not.toMatch(/SENSITIVE|private.invalid|token/);
    }
  }));
  it("cancels the read transport when the requesting client disconnects", async () => withServer(async h => {
    let signal: AbortSignal | undefined;
    h.load.mockImplementation((input: AbortSignal) => new Promise((_resolve, reject) => { signal = input; input.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }); }));
    const controller = new AbortController(), pending = fetch(h.base+path,{ signal: controller.signal });
    void pending.catch(() => {});
    await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal)); controller.abort();
    await expect(pending).rejects.toThrow(); await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  }));
});
