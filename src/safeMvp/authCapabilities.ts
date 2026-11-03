import { Router } from "express";
import { authCapabilitiesSchema } from "../contracts/authCapabilities";
import { sendV1Error } from "../middleware/v1Errors";

export function createAuthCapabilitiesRouter(passwordResetEnabled: boolean) {
  const router = Router();
  // Public configuration only. No database, provider calls or user lookup.
  router.get("/auth-capabilities", (req, res) => {
    res.set("cache-control", "no-store");
    if (Object.keys(req.query).length) return sendV1Error(res, 400, "INVALID_INPUT", "Invalid capabilities query");
    res.json(authCapabilitiesSchema.parse({ passwordReset: { enabled: passwordResetEnabled } }));
  });
  return router;
}
