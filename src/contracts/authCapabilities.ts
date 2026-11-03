import { z } from "zod";

// Configuration availability only; this does not assert mail delivery or expose
// provider credentials, account membership, billing or administrative settings.
export const authCapabilitiesSchema = z.object({
  passwordReset: z.object({ enabled: z.boolean() }).strict(),
}).strict();
export const passwordResetRequestSchema = z.object({
  email: z.email().max(320),
  redirectTo: z.string().max(2048).optional(),
}).strict();
export const passwordResetSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9]{24}$/),
  newPassword: z.string().min(8).max(128),
}).strict();
export const passwordResetRequestedSchema = z.object({ status: z.literal(true), message: z.string().min(1).max(300) }).strict();
export const passwordResetCompletedSchema = z.object({ status: z.literal(true) }).strict();
