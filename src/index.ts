import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth";
import { prisma } from "./lib/prisma";
import { createSafeMvpRouter } from "./safeMvp/router";
import { createDraftRouter } from "./safeMvp/drafts";

const userIdFor = async (req: Parameters<Parameters<typeof createDraftRouter>[0]>[0]) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return session?.user?.id ?? null;
};
export const indexRouter = Router();
indexRouter.use(createSafeMvpRouter(async req => Boolean(await userIdFor(req))));
indexRouter.use(createDraftRouter(userIdFor, {
  get: async userId => prisma.requestDraft.findUnique({ where: { userId }, select: { repositoryId: true, fixtureKey: true, issueNumber: true } }),
  put: async (userId, draft) => { await prisma.requestDraft.upsert({ where: { userId }, create: { userId, ...draft }, update: draft }); },
  delete: async userId => { await prisma.requestDraft.deleteMany({ where: { userId } }); },
}));
