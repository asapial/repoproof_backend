import { createHmac } from "node:crypto";
import type { PrismaClient } from "../../prisma/generated/prisma/client";

type Database = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;
export function authRateStorage(database: Database, secret: string) {
  const digest = (key: string) => createHmac("sha256", secret).update(`auth-rate:${key}`).digest("hex");
  const take = async (key: string, window: number, max: number) => {
    const result = await database.$queryRaw<{ allowed: boolean }[]>`
      INSERT INTO "AuthRateBucket" ("key", "count", "expiresAt")
      VALUES (${digest(key)}, 1, clock_timestamp() + ${window} * interval '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthRateBucket"."expiresAt" <= clock_timestamp() THEN 1 ELSE "AuthRateBucket"."count" + 1 END,
        "expiresAt" = CASE WHEN "AuthRateBucket"."expiresAt" <= clock_timestamp() THEN clock_timestamp() + ${window} * interval '1 second' ELSE "AuthRateBucket"."expiresAt" END
      WHERE "AuthRateBucket"."expiresAt" <= clock_timestamp() OR "AuthRateBucket"."count" < ${max}
      RETURNING true AS allowed`;
    return result.length === 1;
  };
  return { async consume(key: string, rule: { window: number; max: number }) {
    if (key.length > 2048 || !Number.isSafeInteger(rule.window) || rule.window < 1 || rule.window > 900 || !Number.isSafeInteger(rule.max) || rule.max < 1 || rule.max > 1000) return { allowed: false, retryAfter: 60 };
    try {
      // Shared global cap bounds database writes/new keys even with many IPs.
      if (!(await take("global", 60, 600))) return { allowed: false, retryAfter: 60 };
      // Foreground bounded pruning; no background worker or cron assumption.
      await database.$executeRaw`DELETE FROM "AuthRateBucket" WHERE "key" IN (SELECT "key" FROM "AuthRateBucket" WHERE "expiresAt" < clock_timestamp() - interval '15 minutes' LIMIT 100)`;
      const allowed = await take(`client:${key}`, rule.window, rule.max);
      return { allowed, retryAfter: allowed ? null : rule.window };
    } catch {
      // Database failure must not disable throttling or print credentials.
      console.error(JSON.stringify({ event: "auth_rate_store_unavailable" }));
      return { allowed: false, retryAfter: 60 };
    }
  } };
}
