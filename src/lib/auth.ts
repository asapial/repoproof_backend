import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { envVars } from "../config/env";
import { securityConfig } from "../config/security";
import { authSecurityOptions } from "./authSecurity";
import { prisma } from "./prisma";

const security = securityConfig(envVars.FRONTEND_URL, envVars.NODE_ENV === "production", envVars.BETTER_AUTH_URL);
const cookiePolicy = authSecurityOptions(security.allowedOrigin, envVars.NODE_ENV === "production", envVars.BETTER_AUTH_URL === envVars.FRONTEND_URL);
export const auth = betterAuth({
    ...cookiePolicy,
    secret: envVars.BETTER_AUTH_SECRET,
    baseURL: envVars.BETTER_AUTH_URL,
    session: {
        ...cookiePolicy.session,
        ...envVars.SESSION,
    },
    database: prismaAdapter(prisma, { provider: "postgresql" }),
});
