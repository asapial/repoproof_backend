import { Router, type Request, type RequestHandler } from "express";
import { requestDraftResponseSchema, requestDraftSchema, type RequestDraftInput } from "../contracts/requestDraft";
import { safeFixtureCatalogSchema } from "../contracts/safeMvp";
import { sendV1Error, validateV1Body } from "../middleware/v1Errors";
import { approvedFixtures } from "./router";

export interface DraftStore {
  get(userId: string): Promise<RequestDraftInput | null>;
  put(userId: string, draft: RequestDraftInput): Promise<void>;
  delete(userId: string): Promise<void>;
}

export function createDraftRouter(userIdFor: (request: Request) => Promise<string | null>, store: DraftStore, configuredFixtures: unknown = approvedFixtures): Router {
  const catalog = safeFixtureCatalogSchema.parse({ repositories: configuredFixtures });
  const allowed = (draft: RequestDraftInput) => catalog.repositories.some(item => item.repositoryId === draft.repositoryId && item.fixtureKey === draft.fixtureKey && item.issueNumber === draft.issueNumber);
  const router = Router();
  const authenticate: RequestHandler = async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = await userIdFor(req);
      if (!userId) return sendV1Error(res, 401, "UNAUTHENTICATED", "Authentication required");
      res.locals.draftUserId = userId;
      next();
    } catch (error) { next(error); }
  };
  router.get("/request-draft", authenticate, async (_req, res, next) => {
    try {
      const draft = await store.get(res.locals.draftUserId as string);
      const parsed = requestDraftSchema.safeParse(draft);
      // Revoked or invalid catalog entries must not be exposed to the user.
      return res.json(requestDraftResponseSchema.parse({ draft: parsed.success && allowed(parsed.data) ? parsed.data : null }));
    } catch (error) { next(error); }
  });
  router.put("/request-draft", authenticate, validateV1Body(requestDraftSchema), async (req, res, next) => {
    try {
      const draft = requestDraftSchema.parse(req.body);
      if (!allowed(draft)) return sendV1Error(res, 404, "NOT_FOUND", "Resource not found");
      await store.put(res.locals.draftUserId as string, draft);
      return res.json(requestDraftResponseSchema.parse({ draft }));
    } catch (error) { next(error); }
  });
  router.delete("/request-draft", authenticate, async (_req, res, next) => {
    try {
      await store.delete(res.locals.draftUserId as string);
      return res.json(requestDraftResponseSchema.parse({ draft: null }));
    } catch (error) { next(error); }
  });
  return router;
}
