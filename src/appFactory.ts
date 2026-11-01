import express, { type RequestHandler, type Router } from "express";
import cookieParser from "cookie-parser";
import { securityConfig } from "./config/security";
import { assignV1RequestId, sendV1Error, v1ErrorHandler } from "./middleware/v1Errors";
import { authRequestGuards } from "./middleware/authRequest";

export function createApp(authHandler: RequestHandler, router: Router, frontendUrl: string, production: boolean, backendUrl?: string, options: { app?: ReturnType<typeof express>; checkReadiness?: () => Promise<unknown>; readinessTimeoutMs?: number } = {}) {
  const app = options.app ?? express();
  app.disable("x-powered-by");
  const security = securityConfig(frontendUrl, production, backendUrl);
  app.use("/api/v1", assignV1RequestId);
  app.use(security.originGuard);
  app.use(security.cors);
  // Pinned Better Call supports parsed JSON. Bound it before auth processing.
  app.use("/api/auth", ...authRequestGuards(process.env.VERCEL === "1"));
  app.all('/api/auth/*splat', authHandler);
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));
  app.use("/api/v1", security.csrfGuard);
  // Health Check Route
  app.get("/healthz", (_req, res) => { res.set("cache-control", "no-store").json({ status: "ok" }); });
  app.get("/readyz", async (_req, res) => {
    res.set("cache-control", "no-store");
    if (!options.checkReadiness) return res.status(503).json({ status: "unavailable" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([options.checkReadiness(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Readiness deadline")), options.readinessTimeoutMs ?? 2000); })]);
      return res.json({ status: "ready" });
    } catch { return res.status(503).json({ status: "unavailable" }); }
    finally { if (timer) clearTimeout(timer); }
  });
  app.get("/", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "Server is running successfully",
      service: "Backend API",
      version: "1.0.0",
      environment: process.env.NODE_ENV ?? "development",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
  app.use("/api/v1", router);
  app.use("/api/v1", (_req, res) => sendV1Error(res, 404, "NOT_FOUND", "Resource not found"));
  app.use(v1ErrorHandler);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    if (res.headersSent) { res.destroy(); return; }
    res.status(500).json({ message: "Internal server error" });
  });
  return app;
}
