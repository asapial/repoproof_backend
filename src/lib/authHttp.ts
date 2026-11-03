import type { RequestHandler } from "express";

// Better Call's fallback logs arbitrary non-API exceptions. Native auth is set
// to rethrow those errors so this boundary can retain a fixed event/response.
// Native APIError responses (validation, limits, origin checks) stay unchanged.
export function authFailureBoundary(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try { await handler(req, res, next); }
    catch {
      console.error(JSON.stringify({ event: "auth_error" }));
      if (res.headersSent) { res.destroy(); return; }
      res.status(500).json({ code: "AUTH_UNAVAILABLE", message: "Authentication unavailable" });
    }
  };
}
