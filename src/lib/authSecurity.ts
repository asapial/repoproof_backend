import { betterAuth } from "better-auth";

// The same options are used by production and the in-memory integration tests.
export function authSecurityOptions(frontendOrigin: string, production: boolean, sameOrigin = false) {
  return {
    trustedOrigins: [frontendOrigin],
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    advanced: {
      cookiePrefix: "better-auth",
      useSecureCookies: production,
      crossSubDomainCookies: { enabled: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      defaultCookieAttributes: { sameSite: production && !sameOrigin ? "none" as const : "lax" as const, secure: production, httpOnly: true, path: "/" },
    },
  } satisfies Parameters<typeof betterAuth>[0];
}
