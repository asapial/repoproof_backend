import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { denyMetaAccess } from "../meta/access";
import { metaAccountingAttemptSchema, metaAccountingObservationSchema, PostgresMetaAccounting, type MetaAccountingAttempt } from "./metaAccounting";

const effectId = "10000000-0000-4000-8000-000000000001", jobId = "20000000-0000-4000-8000-000000000001";
const attempt: MetaAccountingAttempt = { effectId, jobId, jobVersion: 2, requestHash: "a".repeat(64), model: "synthetic-model",
  maxOutputTokens: 32, source: "OFFLINE_SYNTHETIC" };
const usage = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14,
  prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } };
function fixture() {
  let intent: Record<string, unknown> | undefined, observation: Record<string, unknown> | undefined, loseAck = false;
  const release = vi.fn(), query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql === "COMMIT" && loseAck) throw new Error("sensitive driver details");
    if (sql.startsWith('INSERT INTO public."MetaAttemptAccounting"')) {
      const [effectId,jobId,jobVersion,requestHash,model,maxOutputTokens,source,intentSha256] = values;
      intent = { effectId,jobId,jobVersion,requestHash,model,maxOutputTokens,source,intentSha256 };
    }
    if (sql.startsWith('INSERT INTO public."MetaUsageObservation"')) {
      const [effectId,outcome,usagePresent,promptTokens,completionTokens,totalTokens,cachedTokens,reasoningTokens,observationSha256] = values;
      observation = { effectId,outcome,usagePresent,promptTokens,completionTokens,totalTokens,cachedTokens,reasoningTokens,observationSha256 };
    }
    const row = sql.startsWith("SELECT") ? sql.includes('FROM public."MetaAttemptAccounting"') ? intent : observation : undefined;
    return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
  });
  const connect = vi.fn(async () => ({ query, release })), pool = { connect } as unknown as Pick<Pool, "connect">;
  return { store: new PostgresMetaAccounting(pool), pool, query, connect, release,
    corruptIntent: (value: Record<string, unknown>) => Object.assign(intent!, value),
    corruptObservation: (value: Record<string, unknown>) => Object.assign(observation!, value),
    loseAck: () => { loseAck = true; }, restoreAck: () => { loseAck = false; } };
}

describe("durable Meta accounting without spending authority", () => {
  it("keeps pending usage unknown and retains actual counts and optional details", async () => {
    const h = fixture(), prepared = await h.store.prepare(attempt);
    expect(prepared).toMatchObject({ ok: true, value: { observation: null, dispatchAllowed: false, noChargeEntitlementVerified: false, independentReviewRequired: true } });
    expect(await h.store.record({ effectId, outcome: "RECEIVED", usage })).toMatchObject({ ok: true, value: { observation: { effectId, outcome: "RECEIVED", usage }, outputLimitExceeded: false } });
    expect(await new PostgresMetaAccounting(h.pool).load(effectId)).toEqual(await h.store.load(effectId));
    expect(JSON.stringify(h.store)).toBe('{"store":"postgres-meta-accounting"}');
    expect(await denyMetaAccess.reserve({ requestSha256: attempt.requestHash, model: attempt.model, maxOutputTokens: 32 })).toBeNull();
  });
  it.each(["RECEIVED", "REJECTED", "UNCERTAIN"] as const)("preserves absent %s usage as null, never zero or entitlement", async outcome => {
    const h = fixture(); await h.store.prepare(attempt);
    expect(await h.store.record({ effectId, outcome, usage: null })).toMatchObject({ ok: true, value: { observation: { outcome, usage: null }, noChargeEntitlementVerified: false } });
    expect(await h.store.record({ effectId, outcome: "RECEIVED", usage })).toEqual({ ok: true, value: null });
    expect(await h.store.load(effectId)).toMatchObject({ ok: true, value: { observation: { outcome, usage: null } } });
  });
  it("distinguishes reported zero and omitted details and flags over-limit usage without losing it", async () => {
    const h = fixture(); await h.store.prepare(attempt);
    const zero = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    expect(await h.store.record({ effectId, outcome: "REJECTED", usage: zero })).toMatchObject({ ok: true, value: { observation: { usage: zero } } });
    expect(await h.store.record({ effectId, outcome: "REJECTED", usage: { ...zero, prompt_tokens_details: { cached_tokens: 0 } } })).toEqual({ ok: true, value: null });
    const another = fixture(); await another.store.prepare(attempt);
    expect(await another.store.record({ effectId, outcome: "RECEIVED", usage: { prompt_tokens: 1, completion_tokens: 33, total_tokens: 34 } })).toMatchObject({ ok: true, value: { outputLimitExceeded: true, dispatchAllowed: false } });
  });
  it("allows exact idempotent recovery and rejects request/model/source/version drift", async () => {
    const h = fixture(); const first = await h.store.prepare(attempt);
    expect(await h.store.prepare({ ...attempt })).toEqual(first);
    for (const changed of [{ model: "other" }, { requestHash: "b".repeat(64) }, { source: "LIVE_UNVERIFIED" as const }, { maxOutputTokens: 64 }, { jobVersion: 3 }, { jobId: effectId }]) {
      expect(await h.store.prepare({ ...attempt, ...changed })).toEqual({ ok: true, value: null });
    }
    expect(h.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(1);
    const recorded = await h.store.record({ effectId, outcome: "RECEIVED", usage });
    expect(await h.store.record({ effectId, outcome: "RECEIVED", usage })).toEqual(recorded);
    expect(await h.store.record({ effectId, outcome: "UNCERTAIN", usage })).toEqual({ ok: true, value: null });
  });
  it("returns unavailable after real-looking commit loss and rereads the original identity without resending", async () => {
    const h = fixture(); h.loseAck();
    expect(await h.store.prepare(attempt)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(h.connect).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledWith(true);
    h.restoreAck(); expect(await h.store.load(effectId)).toMatchObject({ ok: true, value: { observation: null, dispatchAllowed: false } });
    h.loseAck(); expect(await h.store.record({ effectId, outcome: "UNCERTAIN", usage: null })).toEqual({ ok: false, reason: "UNAVAILABLE" });
    h.restoreAck(); expect(await h.store.load(effectId)).toMatchObject({ ok: true, value: { observation: { outcome: "UNCERTAIN", usage: null } } });
    expect(h.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(2);
  });
  it.each([{ model: "secret/key" }, { model: "" }, { maxOutputTokens: 0 }, { maxOutputTokens: 65537 }, { jobVersion: -1 },
    { source: "ENFORCED_NO_CHARGE" }, { requestHash: "A".repeat(64) }, { effectId: "bad" }, { billing: true }])("rejects malformed attempt %j before SQL", async invalid => {
    const h = fixture(); expect(metaAccountingAttemptSchema.safeParse({ ...attempt, ...invalid }).success).toBe(false);
    expect(await h.store.prepare({ ...attempt, ...invalid } as MetaAccountingAttempt)).toEqual({ ok: false, reason: "INVALID" }); expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([{ ...usage, total_tokens: 15 }, { ...usage, prompt_tokens: -1 }, { ...usage, completion_tokens: 0.5 },
    { ...usage, prompt_tokens_details: { cached_tokens: 11 } }, { ...usage, completion_tokens_details: { reasoning_tokens: 5 } },
    { ...usage, total_tokens: Number.MAX_SAFE_INTEGER + 1 }, { ...usage, chargedUsd: 0 },
    { ...usage, completion_tokens_details: { reasoning_tokens: 1, free: true } }])("rejects inconsistent usage %j before SQL", async invalid => {
    const h = fixture(); expect(metaAccountingObservationSchema.safeParse({ effectId, outcome: "RECEIVED", usage: invalid }).success).toBe(false);
    expect(await h.store.record({ effectId, outcome: "RECEIVED", usage: invalid })).toEqual({ ok: false, reason: "INVALID" }); expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([{ model: "changed" }, { intentSha256: "0".repeat(64) }, { effectId: jobId }])("denies corrupted persisted intent %j", async changed => {
    const h = fixture(); await h.store.prepare(attempt); h.corruptIntent(changed);
    expect(await h.store.load(effectId)).toEqual({ ok: false, reason: "UNAVAILABLE" });
  });
  it.each([{ totalTokens: 99 }, { observationSha256: "0".repeat(64) }, { effectId: jobId }, { usagePresent: false }, { promptTokens: null }])("denies corrupted persisted usage %j", async changed => {
    const h = fixture(); await h.store.prepare(attempt); await h.store.record({ effectId, outcome: "RECEIVED", usage }); h.corruptObservation(changed);
    expect(await h.store.load(effectId)).toEqual({ ok: false, reason: "UNAVAILABLE" });
  });
  it("does not create orphan observations or connect for invalid identities", async () => {
    const h = fixture(); expect(await h.store.record({ effectId, outcome: "UNCERTAIN", usage: null })).toEqual({ ok: true, value: null });
    expect(h.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
    h.connect.mockClear(); expect(await h.store.load("bad")).toEqual({ ok: false, reason: "INVALID" }); expect(h.connect).not.toHaveBeenCalled();
  });
  it("bounds stalled storage and destroys late connections without leaking errors or retrying", async () => {
    let resolve!: (client: PoolClient) => void;
    const release = vi.fn(), connect = vi.fn(() => new Promise<PoolClient>(done => { resolve = done; }));
    expect(await new PostgresMetaAccounting({ connect }, 10).load(effectId)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    resolve({ release } as unknown as PoolClient); await Promise.resolve(); expect(release).toHaveBeenCalledWith(true); expect(connect).toHaveBeenCalledTimes(1);
    for (const timeout of [0, 7001, NaN, 0.5]) expect(() => new PostgresMetaAccounting({ connect }, timeout)).toThrow("Invalid Meta accounting deadline");
  });
});
