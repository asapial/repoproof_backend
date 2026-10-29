import express, { type RequestHandler, type Router } from "express";
import cookieParser from "cookie-parser";
import { securityConfig } from "./config/security";
import { assignV1RequestId, sendV1Error, v1ErrorHandler } from "./middleware/v1Errors";

export function createApp(authHandler: RequestHandler, router: Router, frontendUrl: string, production: boolean, backendUrl?: string) {
  const app = express();
  const security = securityConfig(frontendUrl, production, backendUrl);
  app.use("/api/v1", assignV1RequestId);
  app.use(security.originGuard);
  app.use(security.cors);
  // Better Auth must receive the unconsumed request body.
  app.all('/api/auth/*splat', authHandler);
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api/v1", security.csrfGuard);
  // Health Check Route
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
  return app;
}
