import type { PoolConfig } from "pg";

export function databasePoolOptions(connectionString: string): PoolConfig & { enableChannelBinding?: boolean } {
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error("DATABASE_URL must be a PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const mode = url.searchParams.get("sslmode");
  if (mode && !["require", "verify-full", ...(local ? ["disable"] : [])].includes(mode)) throw new Error("DATABASE_URL must require verified TLS");
  const allowed = new Set(["sslmode", "channel_binding", "application_name", "pgbouncer"]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new Error("DATABASE_URL contains unsupported connection options");
  const binding = url.searchParams.get("channel_binding");
  if (binding && !["require", "prefer", "disable"].includes(binding)) throw new Error("DATABASE_URL contains invalid channel binding configuration");
  url.searchParams.delete("sslmode"); url.searchParams.delete("channel_binding"); url.searchParams.delete("pgbouncer");
  const ssl = !local || mode === "require" || mode === "verify-full" ? { rejectUnauthorized: true } : false;
  return { connectionString: url.toString(), ssl, enableChannelBinding: binding !== "disable", max: 2, min: 0, idleTimeoutMillis: 5000, connectionTimeoutMillis: 5000, query_timeout: 5000, allowExitOnIdle: true };
}
export function logDatabaseUnavailable(): void {
  console.error(JSON.stringify({ event: "database_unavailable" }));
}
