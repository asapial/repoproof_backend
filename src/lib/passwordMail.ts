import nodemailer from "nodemailer";
import { z } from "zod";

export type SmtpConfig = {
  SMTP_USER: string; SMTP_PASS: string; SMTP_HOST: string; SMTP_PORT: string; SMTP_FROM: string; SMTP_SECURE: boolean;
};
export function smtpOptions(config: SmtpConfig) {
  return {
    host: config.SMTP_HOST, port: Number(config.SMTP_PORT), secure: config.SMTP_SECURE,
    requireTLS: !config.SMTP_SECURE,
    tls: { minVersion: "TLSv1.2" as const, rejectUnauthorized: true },
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    name: "repoproof", pool: false as const, logger: false as const, debug: false,
    connectionTimeout: 5000, greetingTimeout: 3000, socketTimeout: 5000, dnsTimeout: 3000,
    disableFileAccess: true, disableUrlAccess: true,
  };
}
export function passwordResetMessage(email: string, token: string, frontendOrigin: string) {
  if (!z.email().max(320).safeParse(email).success || !/^[A-Za-z0-9]{24}$/.test(token)) throw new Error("Invalid recovery delivery");
  // A fragment keeps the capability out of HTTP URLs, access logs and referrers.
  // The reset page removes it immediately and submits only a JSON token body.
  const link = new URL("/reset-password", frontendOrigin); link.hash = new URLSearchParams({ token }).toString();
  return { to: { name: "", address: email }, subject: "Reset your RepoProof password",
    text: `A password reset was requested for your RepoProof account.\n\nOpen this link within 15 minutes:\n${link.href}\n\nThe link works once. Resetting your password signs out all devices. If you did not request this, ignore this email.\n` };
}
export function createPasswordMailer(config: SmtpConfig, frontendOrigin: string) {
  const transport = nodemailer.createTransport(smtpOptions(config));
  return async (email: string, token: string) => {
    await transport.sendMail({ from: { name: "RepoProof", address: config.SMTP_FROM }, ...passwordResetMessage(email, token, frontendOrigin) });
  };
}
