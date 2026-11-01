import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./envValidation";

const core = { NODE_ENV: "production", PORT: "3000", DATABASE_URL: "postgresql://user:synthetic@localhost:5432/testdb", BETTER_AUTH_SECRET: "synthetic-only-secret-0123456789abcdef", BETTER_AUTH_URL: "https://api.example.test", FRONTEND_URL: "https://app.example.test" };
const providers = { ENABLE_SMTP: "true", EMAIL_SENDER_SMTP_USER: "user", EMAIL_SENDER_SMTP_PASS: "synthetic", EMAIL_SENDER_SMTP_HOST: "smtp.example.test", EMAIL_SENDER_SMTP_PORT: "587", EMAIL_SENDER_SMTP_FROM: "sender@example.test", ENABLE_GOOGLE_OAUTH: "true", GOOGLE_CLIENT_ID: "synthetic", GOOGLE_CLIENT_SECRET: "synthetic", GOOGLE_CALLBACK_URL: "https://api.example.test/callback", ENABLE_CLOUDINARY: "true", CLOUDINARY_CLOUD_NAME: "synthetic", CLOUDINARY_API_KEY: "synthetic", CLOUDINARY_API_SECRET: "synthetic", ENABLE_OPENROUTER: "true", OpenRouter_API_KEY: "synthetic", ENABLE_META: "true", MODEL_API_KEY: "synthetic", ENABLE_LEGACY_JWT: "true", ACCESS_TOKEN_SECRET: "synthetic-access-secret-0123456789abcdef", REFRESH_TOKEN_SECRET: "synthetic-refresh-secret-0123456789abcdef", ACCESS_TOKEN_EXPIRES_IN: "1h", REFRESH_TOKEN_EXPIRES_IN: "1d" };
describe("environment validation", () => {
  it("starts with only secure core configuration and disables providers and legacy JWT by default", () => {
    const result = parseEnvironment(core);
    expect(result.CLOUDINARY).toBeNull(); expect(result.EMAIL_SENDER).toBeNull(); expect(result.GOOGLE).toBeNull(); expect(result.OPENROUTER_ENABLED).toBe(false);
    expect(() => result.OpenRouter_API_KEY).toThrow(/disabled/); expect(() => result.ACCESS_TOKEN_SECRET).toThrow(/disabled/);
  });
  it("rejects each missing core value, invalid URLs, weak secrets and invalid flags", () => {
    for (const name of Object.keys(core)) { const invalid: Record<string, string | undefined> = { ...core, [name]: undefined }; expect(() => parseEnvironment(invalid)).toThrow(name); }
    for (const invalid of [{ PORT: "0" }, { PORT: "99999" }, { NODE_ENV: "prod" }, { DATABASE_URL: "https://example.test/db" }, { DATABASE_URL: "postgresql://localhost/" }, { BETTER_AUTH_SECRET: "short" }, { FRONTEND_URL: "http://example.test" }, { BETTER_AUTH_URL: "https://user:pass@example.test" }, { BETTER_AUTH_URL: "https://api.example.test/path" }, { ENABLE_OPENROUTER: "yes" }]) expect(() => parseEnvironment({ ...core, ...invalid })).toThrow();
  });
  it("requires every provider credential when its integration is enabled", () => {
    const requirements: Array<[string, string[]]> = [["ENABLE_SMTP", ["EMAIL_SENDER_SMTP_USER", "EMAIL_SENDER_SMTP_PASS", "EMAIL_SENDER_SMTP_HOST", "EMAIL_SENDER_SMTP_PORT", "EMAIL_SENDER_SMTP_FROM"]], ["ENABLE_GOOGLE_OAUTH", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"]], ["ENABLE_CLOUDINARY", ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]], ["ENABLE_OPENROUTER", ["OpenRouter_API_KEY"]], ["ENABLE_META", ["MODEL_API_KEY"]], ["ENABLE_LEGACY_JWT", ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET", "ACCESS_TOKEN_EXPIRES_IN", "REFRESH_TOKEN_EXPIRES_IN"]]];
    for (const [flag, names] of requirements) {
      for (const missing of names) { const invalid: Record<string, string | undefined> = { ...core, ...providers, [missing]: undefined }; expect(() => parseEnvironment(invalid), `${flag} ${missing}`).toThrow(missing); }
    }
    const result = parseEnvironment({ ...core, ...providers });
    expect(result.CLOUDINARY?.CLOUDINARY_CLOUD_NAME).toBe("synthetic"); expect(result.GOOGLE?.clientId).toBe("synthetic"); expect(result.EMAIL_SENDER?.SMTP_PORT).toBe("587"); expect(result.OPENROUTER_ENABLED).toBe(true); expect(result.ACCESS_TOKEN_SECRET).toBe(providers.ACCESS_TOKEN_SECRET);
    expect(() => parseEnvironment({ ...core, ...providers, EMAIL_SENDER_SMTP_PORT: "99999" })).toThrow("EMAIL_SENDER_SMTP_PORT");
    expect(() => parseEnvironment({ ...core, ...providers, GOOGLE_CALLBACK_URL: "http://api.example.test/callback" })).toThrow("GOOGLE_CALLBACK_URL");
    expect(() => parseEnvironment({ ...core, ...providers, ACCESS_TOKEN_SECRET: "short" })).toThrow("ACCESS_TOKEN_SECRET");
  });
  it("validates and applies active session durations and enabled JWT lifetimes", () => {
    expect(parseEnvironment(core).SESSION).toEqual({ expiresIn: 604800, updateAge: 86400 });
    expect(parseEnvironment({ ...core, BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN: "3600", BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE: "300" }).SESSION).toEqual({ expiresIn: 3600, updateAge: 300 });
    for (const value of ["", "0", "-1", "1.5", "NaN", "9999999999999999999"]) {
      expect(() => parseEnvironment({ ...core, BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN: value })).toThrow("BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN");
    }
    expect(() => parseEnvironment({ ...core, BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE: "604800" })).toThrow("BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE");
    expect(() => parseEnvironment({ ...core, ...providers, ACCESS_TOKEN_EXPIRES_IN: "invalid" })).toThrow("ACCESS_TOKEN_EXPIRES_IN");
  });
  it("reports invalid configuration by name without echoing secrets", () => {
    for (const invalid of [{ DATABASE_URL: "https://user:private-value@example.test/db" }, { BETTER_AUTH_URL: "https://user:private-value@example.test" }, { BETTER_AUTH_SECRET: "private-value" }, { BETTER_AUTH_SECRET: "private-value\n".repeat(4) }]) {
      let message = "";
      try { parseEnvironment({ ...core, ...invalid }); } catch (error) { message = (error as Error).message; }
      expect(message).not.toBe(""); expect(message).not.toContain("private-value");
    }
  });
  it("accepts development HTTP and ignores credentials for explicitly disabled providers", () => {
    expect(parseEnvironment({ ...core, NODE_ENV: "development", FRONTEND_URL: "http://localhost:3000", BETTER_AUTH_URL: "http://localhost:5000" }).NODE_ENV).toBe("development");
    expect(parseEnvironment({ ...core, ENABLE_GOOGLE_OAUTH: "false", GOOGLE_CALLBACK_URL: "invalid", ENABLE_OPENROUTER: "false", OpenRouter_API_KEY: "unused" }).GOOGLE).toBeNull();
  });
});
