import { afterEach, expect, it, vi } from "vitest";
import { databasePoolOptions, logDatabaseUnavailable } from "./databasePool";

afterEach(() => vi.restoreAllMocks());
it("bounds per-instance PostgreSQL resources and connection/query waits", () => {
  expect(databasePoolOptions("postgresql://synthetic@localhost/test")).toMatchObject({ max: 2, min: 0, idleTimeoutMillis: 5000, connectionTimeoutMillis: 5000, query_timeout: 5000, allowExitOnIdle: true });
});
it("does not log driver errors or database credentials", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  Reflect.apply(logDatabaseUnavailable, undefined, [new Error("postgresql://private-password@db.example/test")]);
  expect(log).toHaveBeenCalledWith('{"event":"database_unavailable"}');
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-password");
});
