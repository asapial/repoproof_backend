import { Router, type Request } from "express";
import { runHistoryQuerySchema, runHistoryResponseSchema, type HistoryCursor } from "../contracts/runHistory";
import { sendV1Error } from "../middleware/v1Errors";
import { decodeHistoryCursor, type HistoryStore } from "./historyStore";

type RateStorage = { consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean }> };
export function historyLimiter(storage: RateStorage) {
  return async (userId: string): Promise<boolean> => {
    try {
      if (!(await storage.consume(`history:user:${userId}`, { window: 60, max: 60 })).allowed) return false;
      return (await storage.consume("history:global", { window: 60, max: 300 })).allowed;
    } catch { return false; }
  };
}
/** Reading persisted run records grants no execution or verdict authority. */
export function createRunHistoryRouter(userIdFor: (request: Request) => Promise<string | null>, store: HistoryStore, allow: (userId: string) => Promise<boolean>) {
  const router = Router();
  router.get("/runs", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = await userIdFor(req);
      if (!userId) return sendV1Error(res, 401, "UNAUTHENTICATED", "Authentication required");
      const query = runHistoryQuerySchema.safeParse(req.query);
      if (!query.success) return sendV1Error(res, 400, "INVALID_INPUT", "Invalid history query");
      let before: HistoryCursor | null = null;
      try { if (query.data.cursor !== undefined) before = decodeHistoryCursor(query.data.cursor); }
      catch { return sendV1Error(res, 400, "INVALID_INPUT", "Invalid history cursor"); }
      if (!(await allow(userId))) { res.set("Retry-After", "60"); return sendV1Error(res, 429, "HISTORY_RATE_LIMITED", "History request limit reached. Try again later"); }
      try {
        const result = runHistoryResponseSchema.parse(await store.list(userId, query.data.limit ?? 10, before));
        return res.json(result);
      } catch { return sendV1Error(res, 503, "HISTORY_UNAVAILABLE", "Run history is temporarily unavailable"); }
    } catch (error) { next(error); }
  });
  return router;
}
