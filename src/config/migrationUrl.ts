export function migrationUrl(input: Readonly<Record<string, string | undefined>>): string | undefined {
  const name = input.DIRECT_URL === undefined ? "DATABASE_URL" : "DIRECT_URL";
  const value = input[name];
  if (value === undefined) return undefined; // Prisma generation needs no connection.
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a PostgreSQL URL`); }
  if (!value.trim() || /[\r\n\0]/.test(value) || !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === "/") throw new Error(`${name} must be a PostgreSQL URL with database name`);
  return value;
}
