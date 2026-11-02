type RateStorage = { consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean }> };

/** Shared PostgreSQL-backed limits, never per-Function memory or a client identity. */
export function issuePreviewLimiter(storage: RateStorage) {
  return async (userId: string): Promise<boolean> => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) return false;
    // A preview makes two GETs. Five shared admissions/15 minutes permits at
    // most 50 GETs in a rolling hour (including partial edge windows), below 60.
    // Other users of the same outbound IP can still exhaust GitHub's quota.
    try {
      if (!(await storage.consume(`github-preview:user:${userId}`, { window: 900, max: 2 })).allowed) return false;
      return (await storage.consume("github-preview:global", { window: 900, max: 5 })).allowed;
    } catch { return false; }
  };
}
