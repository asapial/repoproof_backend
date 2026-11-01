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
it("forces certificate verification for Neon and removes URL overrides before pg parses them", () => {
  const options = databasePoolOptions("postgresql://runtime:synthetic@ep-test-pooler.us-east-2.aws.neon.tech/db?sslmode=require&channel_binding=require");
  expect(options.ssl).toEqual({ rejectUnauthorized: true }); expect(options.enableChannelBinding).toBe(true);
  expect(options.connectionString).not.toContain("sslmode"); expect(options.connectionString).not.toContain("channel_binding");
});
it("rejects TLS downgrades and options that could bypass bounds or read local files", () => {
  for (const query of ["sslmode=disable", "sslmode=no-verify", "sslmode=prefer", "sslrootcert=/private/key", "query_timeout=0", "channel_binding=invalid"]) expect(() => databasePoolOptions(`postgresql://runtime@db.example.test/db?${query}`)).toThrow("DATABASE_URL");
  expect(databasePoolOptions("postgresql://runtime@127.0.0.1/local").ssl).toBe(false);
  expect(databasePoolOptions("postgresql://runtime@db.example.test/db").ssl).toEqual({ rejectUnauthorized: true });
});
