import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { createRunRequestSchema } from "../contracts/v1";
import { sendV1Error, validateV1Body } from "../middleware/v1Errors";

// This is public curated metadata, not a live GitHub response or runner manifest.
const publicFixtureSchema = z.object({
  repositoryId: z.string().regex(/^[a-z0-9-]+$/).max(128),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200),
  fixtureKey: z.string().regex(/^[a-z0-9-]+$/).max(128),
  issueNumber: z.number().int().positive().safe(),
  source: z.literal("CURATED"),
}).strict();
export const publicCatalogSchema = z.object({ repositories: z.array(publicFixtureSchema).max(100) }).strict();
const approvedFixtures = [{ repositoryId: "repoproof-backend", repository: "asapial/repoproof_backend", fixtureKey: "discount-bug", issueNumber: 1, source: "CURATED" }] as const;

export function createSafeMvpRouter(
  hasSession: (request: Request) => Promise<boolean>,
  configuredFixtures: unknown = approvedFixtures,
): Router {
  const catalog = publicCatalogSchema.parse({ repositories: configuredFixtures });
  const keys = new Set(catalog.repositories.map(item => `${item.repositoryId}:${item.fixtureKey}`));
  if (keys.size !== catalog.repositories.length || new Set(catalog.repositories.map(item => item.repositoryId)).size !== catalog.repositories.length) {
    throw new Error("Duplicate fixture catalog entries");
  }
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
