import { z } from "zod";

export const metaUsageSchema = z.object({ prompt_tokens: z.number().int().nonnegative().safe(), completion_tokens: z.number().int().nonnegative().safe(), total_tokens: z.number().int().nonnegative().safe(), prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().safe() }).optional(), completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().safe() }).optional() })
  .refine(value => value.total_tokens === value.prompt_tokens + value.completion_tokens && (value.completion_tokens_details?.reasoning_tokens ?? 0) <= value.completion_tokens && (value.prompt_tokens_details?.cached_tokens ?? 0) <= value.prompt_tokens);
export type MetaUsage = z.infer<typeof metaUsageSchema>;
export type MetaAttempt = { requestSha256: string; model: string; maxOutputTokens: number };
export const zeroChargeReservationSchema = z.object({ id: z.string().uuid(), requestSha256: z.string().regex(/^[a-f0-9]{64}$/), model: z.string().min(1), maxChargeUsd: z.literal(0), billing: z.literal("ENFORCED_NO_CHARGE"), expiresAt: z.number().int().positive().safe() }).strict();
export type MetaReservation = z.infer<typeof zeroChargeReservationSchema>;
export interface MetaAccess {
  // Trusted server-owned controller only. Must atomically reserve a fresh durable
  // permission under verified provider-side no-charge enforcement, not an alert,
  // key, caller bool, token estimate or client-supplied model response.
  reserve(attempt: MetaAttempt): Promise<MetaReservation | null>;
  record(observation: { reservationId: string; outcome: "RECEIVED" | "REJECTED" | "UNCERTAIN"; usage: MetaUsage | null }): Promise<void>;
}
export const denyMetaAccess: MetaAccess = Object.freeze({ reserve: async () => null, record: async () => {} });
