import { Router, type Request, type RequestHandler } from "express";
import { createRunRequestSchema } from "../contracts/v1";
import { safeFixtureCatalogSchema } from "../contracts/safeMvp";
export { safeFixtureCatalogSchema as publicCatalogSchema } from "../contracts/safeMvp";
import { sendV1Error, validateV1Body } from "../middleware/v1Errors";

// This is public curated metadata, not a live GitHub response or runner manifest.
export const approvedFixtures = [{ repositoryId: "repoproof-backend", repository: "asapial/repoproof_backend", fixtureKey: "discount-bug", issueNumber: 1, source: "CURATED" }] as const;

export function createSafeMvpRouter(
  hasSession: (request: Request) => Promise<boolean>,
  configuredFixtures: unknown = approvedFixtures,
): Router {
  const catalog = safeFixtureCatalogSchema.parse({ repositories: configuredFixtures });
  const router = Router();
  const authenticate: RequestHandler = async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!(await hasSession(req))) return sendV1Error(res, 401, "UNAUTHENTICATED", "Authentication required");
      next();
    } catch (error) { next(error); }
  };
  // Curated public fixtures are explicitly available to authenticated sessions.
  router.get("/repositories", authenticate, (_req, res) => res.json(catalog));
  router.post("/runs", authenticate, validateV1Body(createRunRequestSchema), (req, res) => {
    const request = createRunRequestSchema.parse(req.body);
    const allowed = catalog.repositories.some(item => item.repositoryId === request.repositoryId && item.fixtureKey === request.fixtureKey && item.issueNumber === request.issueNumber);
    if (!allowed) return sendV1Error(res, 404, "NOT_FOUND", "Resource not found");
    return sendV1Error(res, 503, "RUNNER_UNAVAILABLE", "The isolated runner is unavailable");
  });
  return router;
}
