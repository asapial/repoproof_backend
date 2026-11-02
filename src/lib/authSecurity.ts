import { betterAuth } from "better-auth";

// The same options are used by production and the in-memory integration tests.
export function authSecurityOptions(frontendOrigin: string, production: boolean, sameOrigin = false) {
  return {
    trustedOrigins: [frontendOrigin],
    emailAndPassword: { enabled: true },
    // PostgreSQL is authoritative on every request. Signed cookies from older
    // releases must not survive server-side revocation or expiry for five minutes.
    session: { cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: "better-auth",
      useSecureCookies: production,
      crossSubDomainCookies: { enabled: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ["x-repoproof-client-ip"], ipv6Subnet: 64 },
      defaultCookieAttributes: { sameSite: production && !sameOrigin ? "none" as const : "lax" as const, secure: production, httpOnly: true, path: "/" },
    },
  } satisfies Parameters<typeof betterAuth>[0];
}
