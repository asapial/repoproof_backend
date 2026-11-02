import { z } from "zod";
import { baseShaSchema, runStateSchema } from "./repoproof";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const count = z.number().int().nonnegative().safe();
export const historyCursorSchema = z.object({ at: z.iso.datetime({ precision: 3 }), id }).strict();
export type HistoryCursor = z.infer<typeof historyCursorSchema>;
export const runHistoryQuerySchema = z.object({
  limit: z.string().regex(/^(?:[1-9]|1[0-9]|2[0-5])$/).transform(Number).optional(),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
export const runHistoryItemSchema = z.object({
  id, repository: z.literal("asapial/repoproof_backend"), issueNumber: z.number().int().positive().safe(),
  issueTitle: z.string().max(320), baseSha: baseShaSchema, state: runStateSchema,
  createdAt: z.iso.datetime({ precision: 3 }), startedAt: z.iso.datetime({ precision: 3 }).nullable(),
  finishedAt: z.iso.datetime({ precision: 3 }).nullable(),
}).strict();
export const runHistorySummarySchema = z.object({
  total: count, running: count, awaitingApproval: count, completed: count, failed: count, cancelled: count,
  repositories: count, submittedIssues: count,
}).strict().refine(value => value.total === value.running + value.awaitingApproval + value.completed + value.failed + value.cancelled &&
  value.repositories <= value.total && value.submittedIssues <= value.total);
export const runHistoryResponseSchema = z.object({
  scope: z.literal("OWNED_RUN_RECORDS"), summary: runHistorySummarySchema,
  runs: z.array(runHistoryItemSchema).max(25), nextCursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).nullable(),
}).strict().superRefine((value, context) => {
  if (value.runs.length > value.summary.total || (value.nextCursor !== null && value.runs.length === 0)) context.addIssue({ code: "custom", message: "Invalid history page" });
  if (new Set(value.runs.map(run => run.id)).size !== value.runs.length) context.addIssue({ code: "custom", message: "Duplicate runs" });
  for (let index = 1; index < value.runs.length; index++) {
    const before = value.runs[index - 1]!, after = value.runs[index]!;
    if (before.createdAt < after.createdAt || (before.createdAt === after.createdAt && before.id <= after.id)) context.addIssue({ code: "custom", message: "History must be ordered" });
  }
});
export type RunHistoryResponse = z.infer<typeof runHistoryResponseSchema>;
export type RunHistoryItem = z.infer<typeof runHistoryItemSchema>;
