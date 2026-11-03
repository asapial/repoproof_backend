import jwt from "jsonwebtoken";
import { z } from "zod";
import { emailVerificationTokenSchema } from "../contracts/emailVerification";

export const emailVerificationPurpose = "repoproof-email-verification.v1";
const nativeClaims = z.object({ email: z.email().max(320), iat: z.number().int().nonnegative(), exp: z.number().int().positive() }).strict();
const taggedClaims = nativeClaims.extend({ purpose: z.literal(emailVerificationPurpose) }).strict();
function times(claims: { iat: number; exp: number }) {
  if (claims.iat > Math.floor(Date.now() / 1000) || claims.exp <= claims.iat || claims.exp - claims.iat > 900) throw new Error("Invalid verification capability");
}
/** Add a purpose claim to a genuine native-issued token without extending TTL. */
export function tagNativeVerificationToken(token: string, email: string, secret: string): string {
  emailVerificationTokenSchema.parse(token);
  const claims = nativeClaims.parse(jwt.verify(token, secret, { algorithms: ["HS256"] })); times(claims);
  if (claims.email !== email.toLowerCase()) throw new Error("Invalid verification capability");
  return jwt.sign({ ...claims, purpose: emailVerificationPurpose }, secret, { algorithm: "HS256" });
}
/** Reject raw native, email-change, wrong-purpose/algorithm and expired tokens. */
export function validateVerificationToken(token: string, secret: string): void {
  emailVerificationTokenSchema.parse(token);
  const claims = taggedClaims.parse(jwt.verify(token, secret, { algorithms: ["HS256"], maxAge: "15m" })); times(claims);
}
