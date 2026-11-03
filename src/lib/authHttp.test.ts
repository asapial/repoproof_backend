import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { Router } from "express";
import { createApp } from "../appFactory";
import { authFailureBoundary } from "./authHttp";

describe("native auth unexpected-failure boundary", () => {
  it("returns and logs only fixed safe data for an arbitrary thrown exception", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = createApp(authFailureBoundary(async () => { throw new Error("private-synthetic-token-and-database-details"); }), Router(), "http://localhost:3000", false).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/get-session`);
      expect(response.status).toBe(500); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ code: "AUTH_UNAVAILABLE", message: "Authentication unavailable" });
      expect(error.mock.calls).toEqual([['{"event":"auth_error"}']]);
    } finally { error.mockRestore(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(value => value ? reject(value) : resolve())); }
  });
});
