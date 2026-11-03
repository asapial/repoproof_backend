import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { createEmailVerificationToken } from "better-auth/api";
import { tagNativeVerificationToken, validateVerificationToken, emailVerificationPurpose } from "./emailVerificationToken";
import { verificationMessage } from "./emailVerification";
import { parseEnvironment } from "../config/envValidation";

const secret = "synthetic-verification-only-secret-0123456789", email = "user@example.test";
describe("native email verification capability boundary", () => {
  it("adds an explicit purpose to a native-issued token without extending its lifetime", async () => {
    const native = await createEmailVerificationToken(secret, email, undefined, 900), tagged = tagNativeVerificationToken(native, email, secret);
    expect(() => validateVerificationToken(tagged, secret)).not.toThrow();
    const original = jwt.decode(native) as jwt.JwtPayload, output = jwt.decode(tagged) as jwt.JwtPayload;
    expect(output).toMatchObject({ email, purpose: emailVerificationPurpose, iat: original.iat, exp: original.exp });
    expect(() => validateVerificationToken(native, secret)).toThrow();
    const message = verificationMessage(email, tagged, "https://app.example.test");
    expect(message.text).toContain("https://app.example.test/verify-email#token=" + tagged); expect(message.to).toEqual({ name: "", address: email });
    expect(Object.keys(message).sort()).toEqual(["subject", "text", "to"]);
  });
  it("refuses native email-change, mismatched email and excessive lifetime claims", async () => {
    for (const [token, recipient] of [
      [await createEmailVerificationToken(secret, email, "other@example.test", 900), email],
      [await createEmailVerificationToken(secret, email, undefined, 900), "other@example.test"],
      [await createEmailVerificationToken(secret, email, undefined, 3600), email],
    ]) expect(() => tagNativeVerificationToken(token!, recipient!, secret)).toThrow();
  });
  it("rejects forged, expired, future, wrong-purpose/algorithm and email-change capabilities", () => {
    const now = Math.floor(Date.now() / 1000), claims = { email, purpose: emailVerificationPurpose, iat: now, exp: now + 900 };
    const tokens = ["not-a-token", jwt.sign(claims, "different-synthetic-secret", { algorithm: "HS256" }), jwt.sign(claims, secret, { algorithm: "HS512" }),
      jwt.sign({ ...claims, exp: now - 1, iat: now - 901 }, secret), jwt.sign({ ...claims, iat: now + 30 }, secret),
      jwt.sign({ ...claims, purpose: "other-purpose" }, secret), jwt.sign({ ...claims, updateTo: "other@example.test" }, secret)];
    for (const token of tokens) expect(() => validateVerificationToken(token, secret)).toThrow();
    expect(() => verificationMessage("x@example.test\nBcc:other@example.test", tokens[1]!, "https://app.example.test")).toThrow();
  });
  it("defaults off and requires explicit approved SMTP when enabled", () => {
    const core = { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/test", BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: "http://localhost:5000", FRONTEND_URL: "http://localhost:3000" };
    expect(parseEnvironment(core).EMAIL_VERIFICATION_ENABLED).toBe(false);
    expect(() => parseEnvironment({ ...core, ENABLE_EMAIL_VERIFICATION: "true" })).toThrow("ENABLE_SMTP");
    expect(() => parseEnvironment({ ...core, ENABLE_EMAIL_VERIFICATION: "yes" })).toThrow("ENABLE_EMAIL_VERIFICATION");
  });
});
