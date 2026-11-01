import { afterEach, expect, it, vi } from "vitest";
import { authRateStorage } from "./authRateLimit";

afterEach(() => vi.restoreAllMocks());
function mockDatabase() { return { $queryRaw: vi.fn(), $executeRaw: vi.fn() }; }
it("uses parameterized HMAC keys and bounded foreground pruning", async () => {
  const database = mockDatabase(); database.$queryRaw.mockResolvedValue([{ allowed: true }]);
  const storage = authRateStorage(database, "synthetic-secret");
  expect(await storage.consume("192.0.2.1/sign-in/email", { window: 60, max: 5 })).toEqual({ allowed: true, retryAfter: null });
  expect(database.$queryRaw).toHaveBeenCalledTimes(2); expect(database.$executeRaw).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(database.$queryRaw.mock.calls)).not.toMatch(/192\.0\.2\.1|synthetic-secret|sign-in/);
  expect(database.$queryRaw.mock.calls[1]![1]).toMatch(/^[a-f0-9]{64}$/);
});
it("fails closed at global cap and individual cap", async () => {
  const database = mockDatabase(); const storage = authRateStorage(database, "synthetic-secret");
  database.$queryRaw.mockResolvedValueOnce([]);
  expect(await storage.consume("owned", { window: 60, max: 5 })).toEqual({ allowed: false, retryAfter: 60 }); expect(database.$executeRaw).not.toHaveBeenCalled();
  database.$queryRaw.mockResolvedValueOnce([{ allowed: true }]).mockResolvedValueOnce([]);
  expect(await storage.consume("owned", { window: 60, max: 5 })).toEqual({ allowed: false, retryAfter: 60 });
});
it("redacts database errors and never falls back to per-instance memory", async () => {
  const database = mockDatabase(); database.$queryRaw.mockRejectedValue(new Error("postgresql://private-password"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await authRateStorage(database, "synthetic-secret").consume("owned", { window: 60, max: 5 })).toEqual({ allowed: false, retryAfter: 60 });
  expect(error).toHaveBeenCalledWith('{"event":"auth_rate_store_unavailable"}');
});
it("rejects unsupported windows/counts and unbounded keys before SQL", async () => {
  const database = mockDatabase(); const storage = authRateStorage(database, "synthetic-secret");
  for (const rule of [{ window: 0, max: 5 }, { window: 901, max: 5 }, { window: 60, max: 0 }, { window: 60, max: 1001 }, { window: NaN, max: 5 }]) expect((await storage.consume("owned", rule)).allowed).toBe(false);
  expect((await storage.consume("x".repeat(2049), { window: 60, max: 5 })).allowed).toBe(false); expect(database.$queryRaw).not.toHaveBeenCalled();
});
