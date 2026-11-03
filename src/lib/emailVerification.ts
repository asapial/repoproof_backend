import nodemailer from "nodemailer";
import { z } from "zod";
import { smtpOptions, type SmtpConfig } from "./passwordMail";
import { tagNativeVerificationToken } from "./emailVerificationToken";

type Storage = { consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean }> };
type NativeMail = { user: { id: string; email: string }; token: string };
export class VerificationDeliveryLimited extends Error { constructor() { super("Verification delivery limit reached"); } }
export function verificationMessage(email: string, token: string, frontendOrigin: string) {
  if (!z.email().max(320).safeParse(email).success || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid verification delivery");
  const link = new URL("/verify-email", frontendOrigin); link.hash = new URLSearchParams({ token }).toString();
  return { to: { name: "", address: email }, subject: "Verify your RepoProof email",
    text: `Confirm the email address for your RepoProof account.\n\nOpen this link within 15 minutes:\n${link.href}\n\nThis verifies your email only. It does not change your password or sign you in. If you did not create this account, ignore this email.\n` };
}
export function createVerificationMailer(config: SmtpConfig, frontendOrigin: string) {
  const transport = nodemailer.createTransport(smtpOptions(config));
  return async (email: string, token: string) => { await transport.sendMail({ from: { name: "RepoProof", address: config.SMTP_FROM }, ...verificationMessage(email, token, frontendOrigin) }); };
}
export function emailVerificationOptions(enabled: boolean, secret: string, deliver: (email: string, token: string) => Promise<void>, storage: Storage) {
  return {
    // Public callers use bounded app-owned JSON routes, never a token query or
    // the native anonymous resend route. Direct server API calls still work.
    disabledPaths: ["/send-verification-email", "/verify-email"],
    emailVerification: {
      sendOnSignUp: enabled, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 900,
      ...(enabled ? { sendVerificationEmail: async ({ user, token }: NativeMail) => {
        if (!(await storage.consume("email-verification:delivery:global", { window: 60, max: 30 })).allowed ||
          !(await storage.consume(`email-verification:delivery:user:${user.id}`, { window: 900, max: 3 })).allowed) throw new VerificationDeliveryLimited();
        await deliver(user.email, tagNativeVerificationToken(token, user.email, secret));
      } } : {}),
    },
  };
}
