import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { loadOwnedFixture, fixturePin } from "../sandbox/fixture";
import { freezeDiscountTest, readSnapshot, sha256 } from "../verification/frozen";
import { encodeFrozenPackage } from "../verification/frozenPackage";
import { PostgresFrozenPackages, durableBaseline, generateDurableDiscountPatch } from "./frozenPackages";

const id = "10000000-0000-4000-8000-000000000001";
async function fixture(lostAck = false) {
  const owned = await loadOwnedFixture(), file = owned.find(file => file.path === "src/discount.mjs")!;
  const frozen = freezeDiscountTest(owned, Buffer.from('import { test } from "node:test"; import assert from "node:assert/strict"; import { applyDiscount } from "../src/discount.mjs"; test("freeze before proposal", () => { assert.equal(applyDiscount(100, 20), 80); });'));
  const payload = encodeFrozenPackage(frozen), order: string[] = [], row = { id, payload, manifestSha256: frozen.manifestSha256, payloadSha256: sha256(payload), createdAtMs: 1000 };
  const release = vi.fn(), query = vi.fn(async (sql: string) => {
    order.push(sql.split(" ")[0]!);
    if (lostAck && sql === "COMMIT") throw new Error("Synthetic lost acknowledgement");
    return { rowCount: sql.startsWith("SELECT") ? 1 : 0, rows: sql.startsWith("SELECT") ? [row] : [] };
  });
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pick<Pool, "connect">;
  const source = { baseSha: fixturePin, issue: { number: 1, title: "Owned", body: "Owned issue data" }, files: [{ path: file.path, content: file.content.toString(), sha256: sha256(file.content) }] };
  const generateSourcePatch = vi.fn(async () => {
    order.push("PROPOSAL"); return { data: { baseSha: fixturePin, changes: [{ path: file.path, previousSha256: sha256(file.content), content: 'export function applyDiscount(price, percentage) { return price - price * percentage / 100; }' }], explanation: "Synthetic patch" }, metadata: { id: "synthetic", model: "synthetic", latencyMs: 0 } };
  });
  return { store: new PostgresFrozenPackages(pool), pool, frozen, row, order, source, provider: { generateSourcePatch } };
}
describe("durable freeze capability", () => {
  it("permits a proposal only after durable commit acknowledgement and private capability validation", async () => {
    const h = await fixture(), result = await h.store.persist(id, h.frozen);
    if (!result.ok || !result.value) throw new Error("synthetic persistence fixture");
    const baseline = durableBaseline(result.value), patched = await generateDurableDiscountPatch(result.value, h.provider, h.source);
    expect(h.order).toEqual(["BEGIN", "SET", "SET", "INSERT", "SELECT", "COMMIT", "PROPOSAL"]);
    expect(readSnapshot(patched).filter(file => file.path.startsWith("tests/"))).toEqual(readSnapshot(baseline).filter(file => file.path.startsWith("tests/")));
    await expect(generateDurableDiscountPatch(JSON.parse(JSON.stringify(result.value)), h.provider, h.source)).rejects.toThrow("INVALID_DURABLE_FREEZE");
    expect(h.provider.generateSourcePatch).toHaveBeenCalledTimes(1);
  });
  it("never issues a capability/proposal after unknown commit acknowledgement", async () => {
    const h = await fixture(true), result = await h.store.persist(id, h.frozen);
    expect(result).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(h.provider.generateSourcePatch).not.toHaveBeenCalled();
    expect(h.pool.connect).toHaveBeenCalledTimes(1);
  });
  it("revalidates persisted bytes and manifest before restoring authority", async () => {
    const h = await fixture(); h.row.payloadSha256 = "0".repeat(64);
    expect(await h.store.load(id)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    h.row.payloadSha256 = sha256(Buffer.from("{")); h.row.payload = Buffer.from("{");
    expect(await h.store.load(id)).toEqual({ ok: false, reason: "UNAVAILABLE" });
  });
  it("rejects source drift before invoking a provider", async () => {
    const h = await fixture(), result = await h.store.load(id);
    if (!result.ok || !result.value) throw new Error("synthetic persistence fixture");
    await expect(generateDurableDiscountPatch(result.value, h.provider, { ...h.source, baseSha: "0".repeat(40) })).rejects.toThrow("DURABLE_SOURCE_MISMATCH");
    await expect(generateDurableDiscountPatch(result.value, h.provider, { ...h.source, issue: { ...h.source.issue, number: 2 } })).rejects.toThrow("DURABLE_SOURCE_MISMATCH");
    await expect(generateDurableDiscountPatch(result.value, h.provider, { ...h.source, files: [{ ...h.source.files[0]!, content: "changed" }] })).rejects.toThrow("DURABLE_SOURCE_MISMATCH");
    expect(h.provider.generateSourcePatch).not.toHaveBeenCalled();
  });
  it("revalidates provider patch data before any protected snapshot can change", async () => {
    const h = await fixture(), result = await h.store.load(id);
    if (!result.ok || !result.value) throw new Error("synthetic persistence fixture");
    const response = await h.provider.generateSourcePatch(); h.provider.generateSourcePatch.mockClear();
    response.data.changes[0]!.path = "src/verification/policy.ts";
    h.provider.generateSourcePatch.mockResolvedValueOnce(response);
    await expect(generateDurableDiscountPatch(result.value, h.provider, h.source)).rejects.toThrow("PATCH_POLICY_VIOLATION");
    expect(durableBaseline(result.value).stage).toBe("BASELINE");
  });
  it("rejects malformed identities/forged freezes before connecting and bounds stalled storage", async () => {
    const connect = vi.fn(() => new Promise<PoolClient>(() => {})), store = new PostgresFrozenPackages({ connect }, 10);
    expect(await store.load("bad")).toEqual({ ok: false, reason: "INVALID" });
    expect(await store.persist(id, {} as never)).toEqual({ ok: false, reason: "INVALID" });
    expect(connect).not.toHaveBeenCalled();
    expect(await store.load(id)).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(JSON.stringify(store)).toBe('{"store":"postgres-frozen-packages"}');
  });
});
