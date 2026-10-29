import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth";
import { createSafeMvpRouter } from "./safeMvp/router";

export const indexRouter = createSafeMvpRouter(async req => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return Boolean(session?.user?.id);
});
