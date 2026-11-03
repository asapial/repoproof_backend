import { APIError, createAuthMiddleware } from "better-auth/api";
import { passwordResetRequestSchema, passwordResetSchema } from "../contracts/authCapabilities";

type Storage = { consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean }> };
type Delivery = (email: string, token: string) => Promise<void>;
export const passwordResetLifetimeSeconds = 15 * 60;
export const passwordRecoveryRules = {
  "/request-password-reset": { window: 900, max: 5 },
  "/reset-password": { window: 300, max: 10 },
  "/reset-password/*": { window: 300, max: 10 },
};

/** Native Better Auth owns token generation/consumption and credential writes. */
export function passwordRecoveryOptions(frontendOrigin: string, deliver: Delivery | null, storage: Storage) {
  const callback = new URL("/reset-password", frontendOrigin).href;
  return {
    emailAndPassword: {
      enabled: true,
      resetPasswordTokenExpiresIn: passwordResetLifetimeSeconds,
      revokeSessionsOnPasswordReset: true,
      ...(deliver ? { sendResetPassword: async ({ user, token }: { user: { email: string }; token: string }) => { await deliver(user.email, token); } } : {}),
    },
    // Only the reset-token namespace changes. Existing OAuth/email state keeps
    // its current representation; no raw reset token is stored in PostgreSQL.
    verification: { storeIdentifier: { default: "plain" as const, overrides: { "reset-password:": "hashed" as const } } },
    hooks: { before: createAuthMiddleware(async context => {
      const path = context.path;
      if (path !== "/request-password-reset" && path !== "/reset-password" && !path.startsWith("/reset-password/")) return;
      if (!deliver) throw new APIError("SERVICE_UNAVAILABLE", { code: "PASSWORD_RECOVERY_UNAVAILABLE", message: "Password recovery is unavailable" });
      if (path === "/request-password-reset") {
        const input = passwordResetRequestSchema.safeParse(context.body);
        if (!input.success || Object.keys(context.query ?? {}).length || (input.data.redirectTo !== undefined && input.data.redirectTo !== callback)) {
          throw new APIError("BAD_REQUEST", { code: "INVALID_RECOVERY_REQUEST", message: "Invalid password recovery request" });
        }
        let admitted = false;
        try {
          // Consume equally for registered and unknown addresses. Storage hashes
          // keys with a server secret; neither addresses nor tokens enter logs.
          admitted = (await storage.consume("password-recovery:global", { window: 60, max: 30 })).allowed &&
            (await storage.consume(`password-recovery:email:${input.data.email.toLowerCase()}`, { window: 900, max: 3 })).allowed;
        } catch { throw new APIError("SERVICE_UNAVAILABLE", { code: "PASSWORD_RECOVERY_UNAVAILABLE", message: "Password recovery is unavailable" }); }
        if (!admitted) throw new APIError("TOO_MANY_REQUESTS", { code: "PASSWORD_RECOVERY_RATE_LIMITED", message: "Too many password recovery requests" }, { "retry-after": "900" });
        context.body = { email: input.data.email.toLowerCase(), redirectTo: callback };
      } else if (path === "/reset-password") {
        // Tokens belong in the bounded JSON body, never the API query/log URL.
        if (Object.keys(context.query ?? {}).length || !passwordResetSchema.safeParse(context.body).success) {
          throw new APIError("BAD_REQUEST", { code: "INVALID_RECOVERY_REQUEST", message: "Invalid password recovery request" });
        }
      } else {
        // This app mails fragment links directly to its own reset page. The
        // native URL-token redirect route is not part of the public product API.
        throw new APIError("BAD_REQUEST", { code: "INVALID_RECOVERY_REQUEST", message: "Invalid password recovery request" });
      }
    }) },
  };
}
