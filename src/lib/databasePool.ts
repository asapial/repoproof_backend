import type { PoolConfig } from "pg";

export function databasePoolOptions(connectionString: string): PoolConfig {
  return { connectionString, max: 2, min: 0, idleTimeoutMillis: 5000, connectionTimeoutMillis: 5000, query_timeout: 5000, allowExitOnIdle: true };
}
export function logDatabaseUnavailable(): void {
  console.error(JSON.stringify({ event: "database_unavailable" }));
}
