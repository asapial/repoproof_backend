import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { envVars } from "../config/env";
import { securityConfig } from "../config/security";
import { authSecurityOptions } from "./authSecurity";
import { prisma } from "./prisma";
import { authRateStorage } from "./authRateLimit";
import { waitUntil } from "@vercel/functions";
import { passwordRecoveryOptions, passwordRecoveryRules } from "./passwordRecovery";
import { createPasswordMailer } from "./passwordMail";

const security = securityConfig(envVars.FRONTEND_URL, envVars.NODE_ENV === "production", envVars.BETTER_AUTH_URL);
const cookiePolicy = authSecurityOptions(security.allowedOrigin, envVars.NODE_ENV === "production", envVars.BETTER_AUTH_URL === envVars.FRONTEND_URL);
const rateStorage = authRateStorage(prisma, envVars.BETTER_AUTH_SECRET);
const recovery = passwordRecoveryOptions(envVars.FRONTEND_URL, envVars.EMAIL_SENDER ? createPasswordMailer(envVars.EMAIL_SENDER, envVars.FRONTEND_URL) : null, rateStorage);
export const auth = betterAuth({
    ...cookiePolicy,
    ...recovery,
    secret: envVars.BETTER_AUTH_SECRET,
    baseURL: envVars.BETTER_AUTH_URL,
    session: {
        ...cookiePolicy.session,
        ...envVars.SESSION,
    },
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    advanced: {
        ...cookiePolicy.advanced,
        backgroundTasks: { handler: promise => {
            const safe = promise.catch(() => { console.error(JSON.stringify({ event: "account_mail_unavailable" })); });
            if (process.env.VERCEL === "1") waitUntil(safe);
            else void safe;
        } },
    },
    rateLimit: {
        enabled: true,
        window: 60, max: 120,
        customStorage: rateStorage,
        customRules: {
            ...passwordRecoveryRules,
            "/sign-in/email": { window: 60, max: 5 },
            "/sign-up/email": { window: 900, max: 10 },
        },
    },
    logger: { level: "error", log: () => console.error(JSON.stringify({ event: "auth_error" })) },
    // The native router can log outside its request logger context. Preserve
    // normal API errors, but send unexpected failures to our HTTP boundary.
    onAPIError: { throw: true },
});
