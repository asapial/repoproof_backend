import { describe, expect, it } from "vitest";
import { passwordResetMessage, smtpOptions, type SmtpConfig } from "./passwordMail";
import { parseEnvironment } from "../config/envValidation";

const smtp: SmtpConfig = { SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_USER: "synthetic-user", SMTP_PASS: "synthetic-password", SMTP_FROM: "accounts@example.test", SMTP_SECURE: false };
describe("account mail boundaries", () => {
  it("requires authenticated TLS, disables logging/file/URL access and bounds SMTP waits", () => {
    expect(smtpOptions(smtp)).toMatchObject({ requireTLS: true, secure: false, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, auth: { user: "synthetic-user", pass: "synthetic-password" }, pool: false, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true, connectionTimeout: 5000, socketTimeout: 5000 });
    expect(smtpOptions({ ...smtp, SMTP_PORT: "465", SMTP_SECURE: true })).toMatchObject({ secure: true, requireTLS: false, tls: { rejectUnauthorized: true } });
  });
  it("builds a fixed plain-text link without copying supplied return URLs or names", () => {
    const message = passwordResetMessage("user@example.test", "a".repeat(24), "https://app.example.test");
    expect(message.to).toEqual({ name: "", address: "user@example.test" }); expect(message.text).toContain("https://app.example.test/reset-password#token=" + "a".repeat(24));
    expect(Object.keys(message).sort()).toEqual(["subject", "text", "to"]);
    for (const email of ["x@example.test\r\nBcc:evil@example.test", "Name <x@example.test>"]) expect(() => passwordResetMessage(email, "a".repeat(24), "https://app.example.test")).toThrow();
    expect(() => passwordResetMessage("x@example.test", "invalid", "https://app.example.test")).toThrow();
  });
  it("rejects unsafe enabled SMTP configuration without echoing values and chooses implicit TLS only when requested", () => {
    const input = { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/test", BETTER_AUTH_SECRET: "synthetic-only-secret-0123456789abcdef", BETTER_AUTH_URL: "http://localhost:5000", FRONTEND_URL: "http://localhost:3000", ENABLE_SMTP: "true", EMAIL_SENDER_SMTP_USER: "u", EMAIL_SENDER_SMTP_PASS: "synthetic", EMAIL_SENDER_SMTP_HOST: "smtp.example.test", EMAIL_SENDER_SMTP_PORT: "587", EMAIL_SENDER_SMTP_FROM: "accounts@example.test" };
    expect(parseEnvironment(input).EMAIL_SENDER?.SMTP_SECURE).toBe(false);
    expect(parseEnvironment({ ...input, EMAIL_SENDER_SMTP_PORT: "465" }).EMAIL_SENDER?.SMTP_SECURE).toBe(true);
    for (const invalid of [{ EMAIL_SENDER_SMTP_HOST: "https://smtp.example.test/path" }, { EMAIL_SENDER_SMTP_FROM: "private-value" }, { EMAIL_SENDER_SMTP_SECURE: "no" }]) expect(() => parseEnvironment({ ...input, ...invalid })).toThrow(/EMAIL_SENDER_SMTP_/);
  });
});
