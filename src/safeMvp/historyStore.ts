import { z } from "zod";
import type { PrismaClient } from "../../prisma/generated/prisma/client";
import { historyCursorSchema, runHistoryItemSchema, runHistoryResponseSchema, runHistorySummarySchema, type HistoryCursor, type RunHistoryResponse } from "../contracts/runHistory";

const ownerSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const pageSchema = z.object({ summary: runHistorySummarySchema, runs: z.array(runHistoryItemSchema).max(25), hasMore: z.boolean() }).strict();
export interface HistoryStore { list(userId: string, limit: number, before: HistoryCursor | null): Promise<RunHistoryResponse> }
export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(historyCursorSchema.parse(cursor))).toString("base64url");
}
export function decodeHistoryCursor(value: string): HistoryCursor {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new Error("INVALID_HISTORY_CURSOR");
  try {
    const parsed = historyCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (encodeHistoryCursor(parsed) !== value) throw new Error();
    return parsed;
  } catch { throw new Error("INVALID_HISTORY_CURSOR"); }
}
/** The runtime receives only this bounded SQL projection, never raw evidence. */
export function postgresHistoryStore(database: Pick<PrismaClient, "$queryRaw">): HistoryStore {
  return { async list(userId, limit, before) {
    ownerSchema.parse(userId); z.number().int().min(1).max(25).parse(limit);
    if (before !== null) historyCursorSchema.parse(before);
    const rows = await database.$queryRaw<Array<{ result: unknown }>>`
      SELECT public.repoproof_history_v1(${userId}::text, ${before?.at ?? null}::timestamptz, ${before?.id ?? null}::text, ${limit}::integer) AS result`;
    if (rows.length !== 1) throw new Error("HISTORY_UNAVAILABLE");
    const page = pageSchema.parse(rows[0]!.result), last = page.runs.at(-1);
    if (page.runs.length > limit || (page.hasMore && (page.runs.length !== limit || !last))) throw new Error("HISTORY_UNAVAILABLE");
    return runHistoryResponseSchema.parse({ scope: "OWNED_RUN_RECORDS", summary: page.summary, runs: page.runs,
      nextCursor: page.hasMore && last ? encodeHistoryCursor({ at: last.createdAt, id: last.id }) : null });
  } };
}
