import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../prisma/generated/prisma/client";
import { decodeHistoryCursor, encodeHistoryCursor, postgresHistoryStore } from "./historyStore";

const summary = { total: 2, running: 2, awaitingApproval: 0, completed: 0, failed: 0, cancelled: 0, repositories: 1, submittedIssues: 1 };
const run = { id: "run-z", repository: "asapial/repoproof_backend", issueNumber: 1, issueTitle: "Owned issue", baseSha: "a".repeat(40), state: "QUEUED", createdAt: "2026-11-02T12:00:00.000Z", startedAt: null, finishedAt: null };
function store(result: unknown) {
  const query = vi.fn().mockResolvedValue(result);
  return { query, api: postgresHistoryStore({ $queryRaw: query } as unknown as Pick<PrismaClient, "$queryRaw">) };
}
describe("history cursor", () => {
  it("round-trips exact timestamp/id and rejects noncanonical or extra data", () => {
    const value = { at: run.createdAt, id: run.id }; expect(decodeHistoryCursor(encodeHistoryCursor(value))).toEqual(value);
    for (const input of ["bad", "A".repeat(513), Buffer.from(JSON.stringify({ ...value, userId: "other" })).toString("base64url"), Buffer.from('{ "at":"2026-11-02T12:00:00.000Z","id":"run-z"}').toString("base64url"), Buffer.from(JSON.stringify({ at: "infinity", id: "../secret" })).toString("base64url")]) expect(() => decodeHistoryCursor(input)).toThrow("INVALID_HISTORY_CURSOR");
  });
});
describe("PostgreSQL history result boundary", () => {
  it("binds owner/cursor values as parameters and emits a next cursor only for a full page", async () => {
    const { api, query } = store([{ result: { summary, runs: [run], hasMore: true } }]); const before = { at: run.createdAt, id: "run-zz" };
    const response = await api.list("owner-a", 1, before);
    expect(query.mock.calls[0]!.slice(1)).toEqual(["owner-a", before.at, before.id, 1]);
    expect(decodeHistoryCursor(response.nextCursor!)).toEqual({ at: run.createdAt, id: run.id }); expect(response).not.toHaveProperty("verdict");
  });
  it("rejects invalid owners/page limits before SQL", async () => {
    const { api, query } = store([]);
    await expect(api.list("' OR true --", 1, null)).rejects.toThrow(); await expect(api.list("owner", 26, null)).rejects.toThrow(); expect(query).not.toHaveBeenCalled();
  });
  it.each([
    { result: [] }, { result: [{ result: {} }] }, { result: [{ result: { summary, runs: [], hasMore: true } }] },
    { result: [{ result: { summary: { ...summary, completed: 1 }, runs: [run], hasMore: false } }] },
    { result: [{ result: { summary, runs: [{ ...run, storageKey: "private" }], hasMore: false } }] },
  ])("rejects incomplete/contradictory or private database result", async ({ result }) => {
    await expect(store(result).api.list("owner-a", 1, null)).rejects.toThrow();
  });
  it("does not invent a cursor for the final page", async () => {
    expect((await store([{ result: { summary, runs: [run], hasMore: false } }]).api.list("owner-a", 10, null)).nextCursor).toBe(null);
  });
});
