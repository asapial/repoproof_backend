import { Router, type Request } from "express";
import { issuePreviewSchema } from "../contracts/issuePreview";
import { sendV1Error } from "../middleware/v1Errors";

type Preview = { baseSha: string; issue: { number: number; title: string; body: string; url: string } };
type Dependencies = { allow: (userId: string) => Promise<boolean>; load: (signal: AbortSignal) => Promise<Preview> };

/** Read-only owned GitHub metadata. Never creates a Run or dispatches AI/runner work. */
export function createIssuePreviewRouter(userIdFor: (request: Request) => Promise<string | null>, dependencies: Dependencies): Router {
  const router = Router();
  router.get("/repositories/:id/issues", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", disconnected); res.once("close", disconnected);
    try {
      const userId = await userIdFor(req);
      if (!userId) return sendV1Error(res, 401, "UNAUTHENTICATED", "Authentication required");
      if (req.params.id !== "repoproof-backend") return sendV1Error(res, 404, "NOT_FOUND", "Resource not found");
      if (Object.keys(req.query).length !== 0) return sendV1Error(res, 400, "INVALID_INPUT", "This preview does not accept query parameters");
      if (controller.signal.aborted) return;
      if (!(await dependencies.allow(userId))) {
        res.set("Retry-After", "900");
        return sendV1Error(res, 429, "RATE_LIMITED", "Issue preview limit reached. Try again later");
      }
      if (controller.signal.aborted) return;
      let preview: Preview;
      try { preview = await dependencies.load(controller.signal); }
      catch {
        if (controller.signal.aborted) return;
        return sendV1Error(res, 503, "SOURCE_UNAVAILABLE", "The GitHub issue could not be validated. Try again later");
      }
      if (controller.signal.aborted) return;
      const result = issuePreviewSchema.safeParse({ repositoryId: "repoproof-backend", repository: "asapial/repoproof_backend",
        fixtureKey: "discount-bug", baseSha: preview.baseSha, source: "GITHUB_API", fetchedAt: new Date().toISOString(), issues: [preview.issue] });
      if (!result.success) return sendV1Error(res, 503, "SOURCE_UNAVAILABLE", "The GitHub issue could not be validated. Try again later");
      return res.json(result.data);
    } catch (error) { next(error); }
    finally { req.removeListener("aborted", disconnected); res.removeListener("close", disconnected); }
  });
  return router;
}
