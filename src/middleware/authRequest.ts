import { isIP } from "node:net";
import { json, type RequestHandler, type Response } from "express";

export const authBodyBytes = 16 * 1024;
export function authRequestGuards(vercel: boolean, timeoutMs = 5000, failure: (response: Response, status: number, message: string) => unknown = (response, status, message) => response.status(status).json({ message })): RequestHandler[] {
  const envelope: RequestHandler = (req, res, next) => {
    res.set("cache-control", "no-store");
    // Header is overwritten here. Never trust a caller-supplied internal IP.
    const ip = vercel ? req.get("x-vercel-forwarded-for") : req.socket.remoteAddress;
    if (!ip || !isIP(ip)) return failure(res, 503, "Authentication unavailable");
    req.headers["x-repoproof-client-ip"] = ip;
    delete req.headers["x-forwarded-proto"];
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!req.is("application/json")) return failure(res, 415, "JSON body required");
      if (req.get("content-encoding") && req.get("content-encoding") !== "identity") return failure(res, 415, "Content encoding not supported");
    }
    next();
  };
  const parser = json({ limit: authBodyBytes, strict: true, inflate: false });
  const boundedParser: RequestHandler = (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) failure(res, 408, "Request body timed out");
      req.destroy();
    }, timeoutMs);
    const clear = () => clearTimeout(timer);
    res.once("close", clear);
    parser(req, res, error => {
      clear(); res.removeListener("close", clear);
      if (res.headersSent || req.destroyed) return;
      if (error) {
        const status = typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large" ? 413 : 400;
        return failure(res, status, status === 413 ? "Request body is too large" : "Invalid JSON body");
      }
      next();
    });
  };
  return [envelope, boundedParser];
}
