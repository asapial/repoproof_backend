import { Router, type Request } from "express";
import { isIP } from "node:net";
import { emailVerificationAccountSchema, emailVerificationCapabilitySchema, emailVerificationConfirmSchema, emailVerificationRequestSchema, emailVerificationSuccessSchema } from "../contracts/emailVerification";
import { sendV1Error } from "../middleware/v1Errors";
import { VerificationDeliveryLimited } from "../lib/emailVerification";

export type VerificationUser = { id: string; email: string; emailVerified: boolean };
type Admission = (action: "read" | "request" | "confirm", identity: string) => Promise<boolean>;
type Storage = { consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean }> };
export function emailVerificationLimiter(storage: Storage): Admission {
  return async (action, identity) => {
    if (!identity || identity.length > 128 || /[\r\n\0]/.test(identity) || (action !== "read" && !isIP(identity))) return false;
    const rule = action === "read" ? { window: 60, max: 60 } : { window: 300, max: 10 };
    try {
      if (!(await storage.consume(`email-verification:${action}:global`, { window: 60, max: action === "read" ? 300 : 60 })).allowed) return false;
      return (await storage.consume(`email-verification:${action}:identity:${identity}`, rule)).allowed;
    } catch { return false; }
  };
}
export function createEmailVerificationRouter(options: {
  enabled: boolean; frontendOrigin: string; userFor: (request: Request) => Promise<VerificationUser | null>; allow: Admission;
  request: (user: VerificationUser, request: Request) => Promise<void>; confirm: (token: string) => Promise<boolean>;
}) {
  const router = Router(), unavailable = "Email verification is temporarily unavailable";
  router.use("/email-verification", (req, res, next) => {
    res.set("cache-control", "no-store");
    if (Object.keys(req.query).length) return sendV1Error(res, 400, "INVALID_INPUT", "Invalid verification query");
    if (req.method === "POST" && req.get("origin") !== options.frontendOrigin) return sendV1Error(res, 403, "ORIGIN_REQUIRED", "Origin required");
    next();
  });
  router.get("/email-verification", (_req, res) => res.json(emailVerificationCapabilitySchema.parse({ enabled: options.enabled })));
  router.get("/email-verification/account", async (req, res) => {
    try {
      const user = await options.userFor(req);
      if (!user) return sendV1Error(res, 401, "UNAUTHENTICATED", "Authentication required");
      if (!(await options.allow("read", user.id))) { res.set("retry-after", "60"); return sendV1Error(res, 429, "EMAIL_VERIFICATION_RATE_LIMITED", "Verification request limit reached"); }
      res.json(emailVerificationAccountSchema.parse({ email: user.email, verified: user.emailVerified, enabled: options.enabled }));
    } catch { sendV1Error(res, 503, "EMAIL_VERIFICATION_UNAVAILABLE", unavailable); }
  });
  router.post("/email-verification/request", async (req, res) => {
    try {
      const user = await options.userFor(req);
      if (!user) return sendV1Error(res, 401, "UNAUTHENTICATED", "Authentication required");
      if (!options.enabled) return sendV1Error(res, 503, "EMAIL_VERIFICATION_UNAVAILABLE", unavailable);
      if (!emailVerificationRequestSchema.safeParse(req.body).success) return sendV1Error(res, 400, "INVALID_INPUT", "Invalid verification request");
      if (!(await options.allow("request", String(req.headers["x-repoproof-client-ip"] ?? "")))) { res.set("retry-after", "300"); return sendV1Error(res, 429, "EMAIL_VERIFICATION_RATE_LIMITED", "Verification request limit reached"); }
      if (!user.emailVerified) await options.request(user, req);
      res.status(202).json(emailVerificationSuccessSchema.parse({ status: true }));
    } catch (error) {
      if (error instanceof VerificationDeliveryLimited) { res.set("retry-after", "900"); return sendV1Error(res, 429, "EMAIL_VERIFICATION_RATE_LIMITED", "Verification request limit reached"); }
      sendV1Error(res, 503, "EMAIL_VERIFICATION_UNAVAILABLE", unavailable);
    }
  });
  router.post("/email-verification/confirm", async (req, res) => {
    if (!options.enabled) return sendV1Error(res, 503, "EMAIL_VERIFICATION_UNAVAILABLE", unavailable);
    const input = emailVerificationConfirmSchema.safeParse(req.body);
    if (!input.success) return sendV1Error(res, 400, "INVALID_INPUT", "Invalid verification request");
    try {
      if (!(await options.allow("confirm", String(req.headers["x-repoproof-client-ip"] ?? "")))) { res.set("retry-after", "300"); return sendV1Error(res, 429, "EMAIL_VERIFICATION_RATE_LIMITED", "Verification request limit reached"); }
      if (!(await options.confirm(input.data.token))) return sendV1Error(res, 400, "EMAIL_VERIFICATION_LINK_INVALID", "Verification link is invalid or expired");
      res.json(emailVerificationSuccessSchema.parse({ status: true }));
    } catch { sendV1Error(res, 503, "EMAIL_VERIFICATION_UNAVAILABLE", unavailable); }
  });
  return router;
}
