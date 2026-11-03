import { z } from "zod";

// A separate surface preserves the shipped strict password-recovery capability.
export const emailVerificationCapabilitySchema = z.object({ enabled: z.boolean() }).strict();
export const emailVerificationAccountSchema = z.object({ email: z.email().max(320), verified: z.boolean(), enabled: z.boolean() }).strict();
export const emailVerificationRequestSchema = z.object({}).strict();
export const emailVerificationTokenSchema = z.string().min(80).max(2048).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const emailVerificationConfirmSchema = z.object({ token: emailVerificationTokenSchema }).strict();
export const emailVerificationSuccessSchema = z.object({ status: z.literal(true) }).strict();
