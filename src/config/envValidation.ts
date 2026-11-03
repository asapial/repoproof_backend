type Environment = Readonly<Record<string, string | undefined>>;
type CloudinaryConfig = { CLOUDINARY_CLOUD_NAME: string; CLOUDINARY_API_KEY: string; CLOUDINARY_API_SECRET: string };
import { z } from "zod";
import type { SmtpConfig } from "../lib/passwordMail";
type GoogleConfig = { clientId: string; clientSecret: string; callbackUrl: string };
type LegacyJwtConfig = { accessSecret: string; refreshSecret: string; accessExpiresIn: string; refreshExpiresIn: string };

function required(input: Environment, name: string): string {
  const value = input[name];
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} must not contain control characters`);
  return value;
}
function enabled(input: Environment, name: string): boolean {
  const value = input[name] ?? "false";
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}
function origin(input: Environment, name: string, production: boolean): string {
  let url: URL;
  try { url = new URL(required(input, name)); } catch { throw new Error(`${name} must be an absolute HTTP(S) origin`); }
  if (url.origin === "null" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*") || (production ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol))) throw new Error(`${name} must be an exact allowed origin`);
  return url.origin;
}
function port(input: Environment, name: string): string {
  const value = required(input, name);
  if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${name} must be a valid TCP port`);
  return value;
}
function secret(input: Environment, name: string): string {
  const value = required(input, name);
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}
function seconds(input: Environment, name: string, fallback: string): number {
  const value = input[name] ?? fallback;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 30 * 24 * 60 * 60) throw new Error(`${name} must be positive seconds up to 30 days`);
  return Number(value);
}
function lifetime(input: Environment, name: string): string {
  const value = required(input, name);
  if (!/^[1-9][0-9]*(s|m|h|d)$/.test(value)) throw new Error(`${name} must be a positive duration with s, m, h or d units`);
  return value;
}

export function parseEnvironment(input: Environment) {
  const runtime = required(input, "NODE_ENV");
  if (!["development", "test", "production"].includes(runtime)) throw new Error("NODE_ENV must be development, test or production");
  const production = runtime === "production";
  const database = required(input, "DATABASE_URL");
  let db: URL;
  try { db = new URL(database); } catch { throw new Error("DATABASE_URL must be a PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !db.hostname || !db.pathname || db.pathname === "/" || db.hash) throw new Error("DATABASE_URL must be a PostgreSQL URL with a database name");
  const sessionExpiresIn = seconds(input, "BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN", "604800");
  const sessionUpdateAge = seconds(input, "BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE", "86400");
  if (sessionUpdateAge >= sessionExpiresIn) throw new Error("BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE must be less than BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN");
  const smtpEnabled = enabled(input, "ENABLE_SMTP");
  const emailVerificationEnabled = enabled(input, "ENABLE_EMAIL_VERIFICATION");
  if (emailVerificationEnabled && !smtpEnabled) throw new Error("ENABLE_EMAIL_VERIFICATION requires ENABLE_SMTP");
  const googleEnabled = enabled(input, "ENABLE_GOOGLE_OAUTH");
  const cloudEnabled = enabled(input, "ENABLE_CLOUDINARY");
  const openrouterEnabled = enabled(input, "ENABLE_OPENROUTER");
  const jwtEnabled = enabled(input, "ENABLE_LEGACY_JWT");
  const metaEnabled = enabled(input, "ENABLE_META");
  if (metaEnabled) required(input, "MODEL_API_KEY");
  const smtp: SmtpConfig | null = smtpEnabled ? { SMTP_USER: required(input, "EMAIL_SENDER_SMTP_USER"), SMTP_PASS: required(input, "EMAIL_SENDER_SMTP_PASS"), SMTP_HOST: required(input, "EMAIL_SENDER_SMTP_HOST"), SMTP_PORT: port(input, "EMAIL_SENDER_SMTP_PORT"), SMTP_FROM: required(input, "EMAIL_SENDER_SMTP_FROM"), SMTP_SECURE: input.EMAIL_SENDER_SMTP_SECURE === undefined ? input.EMAIL_SENDER_SMTP_PORT === "465" : enabled(input, "EMAIL_SENDER_SMTP_SECURE") } : null;
  if (smtp) {
    if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/.test(smtp.SMTP_HOST)) throw new Error("EMAIL_SENDER_SMTP_HOST must be a host name or IP address");
    if (!z.email().max(320).safeParse(smtp.SMTP_FROM).success) throw new Error("EMAIL_SENDER_SMTP_FROM must be a single email address");
  }
  const google: GoogleConfig | null = googleEnabled ? { clientId: required(input, "GOOGLE_CLIENT_ID"), clientSecret: required(input, "GOOGLE_CLIENT_SECRET"), callbackUrl: required(input, "GOOGLE_CALLBACK_URL") } : null;
  if (google) {
    let callback: URL;
    try { callback = new URL(google.callbackUrl); } catch { throw new Error("GOOGLE_CALLBACK_URL must be an absolute URL"); }
    if (callback.username || callback.password || callback.hash || (production ? callback.protocol !== "https:" : !["http:", "https:"].includes(callback.protocol))) throw new Error("GOOGLE_CALLBACK_URL must be an allowed HTTP(S) URL");
  }
  const cloudinary: CloudinaryConfig | null = cloudEnabled ? { CLOUDINARY_CLOUD_NAME: required(input, "CLOUDINARY_CLOUD_NAME"), CLOUDINARY_API_KEY: required(input, "CLOUDINARY_API_KEY"), CLOUDINARY_API_SECRET: required(input, "CLOUDINARY_API_SECRET") } : null;
  const openrouter = openrouterEnabled ? required(input, "OpenRouter_API_KEY") : null;
  const legacy: LegacyJwtConfig | null = jwtEnabled ? { accessSecret: secret(input, "ACCESS_TOKEN_SECRET"), refreshSecret: secret(input, "REFRESH_TOKEN_SECRET"), accessExpiresIn: lifetime(input, "ACCESS_TOKEN_EXPIRES_IN"), refreshExpiresIn: lifetime(input, "REFRESH_TOKEN_EXPIRES_IN") } : null;
  const getLegacy = () => { if (!legacy) throw new Error("Legacy JWT integration is disabled"); return legacy; };
  return {
    NODE_ENV: runtime, PORT: input.PORT === undefined ? "5000" : port(input, "PORT"), DATABASE_URL: database,
    BETTER_AUTH_SECRET: secret(input, "BETTER_AUTH_SECRET"),
    SESSION: { expiresIn: sessionExpiresIn, updateAge: sessionUpdateAge },
    BETTER_AUTH_URL: origin(input, "BETTER_AUTH_URL", production), FRONTEND_URL: origin(input, "FRONTEND_URL", production),
    EMAIL_SENDER: smtp, EMAIL_VERIFICATION_ENABLED: emailVerificationEnabled, GOOGLE: google, CLOUDINARY: cloudinary, OPENROUTER_ENABLED: openrouterEnabled,
    get OpenRouter_API_KEY() { if (!openrouter) throw new Error("OpenRouter integration is disabled"); return openrouter; },
    get ACCESS_TOKEN_SECRET() { return getLegacy().accessSecret; },
    get REFRESH_TOKEN_SECRET() { return getLegacy().refreshSecret; },
    get ACCESS_TOKEN_EXPIRES_IN() { return getLegacy().accessExpiresIn; },
    get REFRESH_TOKEN_EXPIRES_IN() { return getLegacy().refreshExpiresIn; },
  };
}
