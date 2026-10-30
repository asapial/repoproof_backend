import { z } from "zod";
import { createRunRequestSchema } from "./v1";

// A saved input selection, not an execution request or a result.
export const requestDraftSchema = createRunRequestSchema.extend({ issueNumber: z.number().int().positive().max(2147483647) });
export const requestDraftResponseSchema = z.object({ draft: requestDraftSchema.nullable() }).strict();
export type RequestDraftInput = z.infer<typeof requestDraftSchema>;
