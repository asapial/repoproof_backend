import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import { sendV1Error } from "../middleware/v1Errors";

export function securityConfig(frontendUrl: string, production: boolean, backendUrl?: string) {
  let url: URL;
  try { url = new URL(frontendUrl); } catch { throw new Error("FRONTEND_URL must be an absolute origin"); }
  if (url.origin === "null" || url.hostname.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (production ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol))) {
    throw new Error("FRONTEND_URL must be an exact HTTP(S) origin; production requires HTTPS");
  }
  const allowedOrigin = url.origin;
  const backend = backendUrl ? new URL(backendUrl) : undefined;
  if (backend && (backend.origin === "null" || backend.username || backend.password || backend.hostname.includes("*") || (production ? backend.protocol !== "https:" : !["http:", "https:"].includes(backend.protocol)))) throw new Error("BETTER_AUTH_URL must use a valid HTTP(S) origin; production requires HTTPS");
  const backendOrigin = backend?.origin;
  const allowedOrigins = new Set([allowedOrigin, ...(backendOrigin ? [backendOrigin] : [])]);
  const originGuard = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      if (/^\/api\/v1(?:\/|$)/i.test(req.path)) return sendV1Error(res, 403, "ORIGIN_NOT_ALLOWED", "Origin not allowed");
      return res.status(403).json({ message: "Origin not allowed" });
    }
    next();
  };
  const csrfGuard = (req: Request, res: Response, next: NextFunction) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.cookie && !allowedOrigins.has(req.get("origin") ?? "")) {
      return sendV1Error(res, 403, "ORIGIN_REQUIRED", "Origin required for cookie-authenticated requests");
    }
    next();
  };
  return {
    allowedOrigin,
    originGuard,
    csrfGuard,
    cors: cors({ origin: allowedOrigin, credentials: true, methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }),
  };
}
