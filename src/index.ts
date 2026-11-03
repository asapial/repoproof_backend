import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth";
import { prisma } from "./lib/prisma";
import { createSafeMvpRouter } from "./safeMvp/router";
import { createDraftRouter } from "./safeMvp/drafts";
import { createIssuePreviewRouter } from "./safeMvp/issues";
import { issuePreviewLimiter } from "./safeMvp/issueRate";
import { authRateStorage } from "./lib/authRateLimit";
import { envVars } from "./config/env";
import { OwnedGitHubIntake } from "./verification/githubIntake";
import { createRunHistoryRouter, historyLimiter } from "./safeMvp/history";
import { postgresHistoryStore } from "./safeMvp/historyStore";
import { createAuthCapabilitiesRouter } from "./safeMvp/authCapabilities";

const userIdFor = async (req: Parameters<Parameters<typeof createDraftRouter>[0]>[0]) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return session?.user?.id ?? null;
};
export const indexRouter = Router();
indexRouter.use(createAuthCapabilitiesRouter(Boolean(envVars.EMAIL_SENDER)));
indexRouter.use(createSafeMvpRouter(async req => Boolean(await userIdFor(req))));
indexRouter.use(createRunHistoryRouter(userIdFor, postgresHistoryStore(prisma), historyLimiter(authRateStorage(prisma, envVars.BETTER_AUTH_SECRET))));
const ownedGitHub = new OwnedGitHubIntake(fetch);
indexRouter.use(createIssuePreviewRouter(userIdFor, {
  allow: issuePreviewLimiter(authRateStorage(prisma, envVars.BETTER_AUTH_SECRET)),
  load: signal => ownedGitHub.preview(signal),
}));
indexRouter.use(createDraftRouter(userIdFor, {
  get: async userId => prisma.requestDraft.findUnique({ where: { userId }, select: { repositoryId: true, fixtureKey: true, issueNumber: true } }),
  put: async (userId, draft) => { await prisma.requestDraft.upsert({ where: { userId }, create: { userId, ...draft }, update: draft }); },
  delete: async userId => { await prisma.requestDraft.deleteMany({ where: { userId } }); },
}));
