import { describe, expect, it, vi } from "vitest";
import { harmlessEffectFetch } from "./harmless";

const empty = () => ({ createInvocations: 0, mutationInvocations: 0, responseStatuses: [] as number[] });
describe("harmless transport observations are counts, never retry authority", () => {
  it("retains an uncertain forwarded create without resending through either origin", async () => {
    const observation = empty(), transport = vi.fn(async () => { throw new Error("synthetic lost acknowledgement"); });
    const guarded = harmlessEffectFetch(transport, observation);
    await expect(guarded("https://vercel.com/api/v3/sandboxes", { method: "POST", body: "{}" })).rejects.toThrow();
    expect((await guarded("https://api.vercel.com/v3/sandboxes", { method: "POST", body: '{"name":"new"}' })).status).toBe(409);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(observation).toEqual({ createInvocations: 1, mutationInvocations: 1, responseStatuses: [] });
  });
  it("does not count local denials as forwarded requests or preserve headers/errors", async () => {
    const observation = empty(), transport = vi.fn(async () => new Response("{}"));
    const guarded = harmlessEffectFetch(transport, observation);
    await expect(guarded("https://evil.example/api/v3/sandboxes", { headers: { authorization: "synthetic-private" } })).rejects.toThrow("denied");
    expect(transport).not.toHaveBeenCalled(); expect(observation).toEqual(empty());
    expect(JSON.stringify(observation)).not.toContain("synthetic-private");
  });
  it("records bounded HTTP status observations without turning GETs into effects", async () => {
    const observation = empty(), guarded = harmlessEffectFetch(async () => new Response("{}", { status: 200 }), observation);
    for (let index = 0; index < 70; index++) await guarded("https://vercel.com/api/v2/sandboxes/sessions/owned");
    expect(observation).toEqual({ createInvocations: 0, mutationInvocations: 0, responseStatuses: Array.from({ length: 64 }, () => 200) });
  });
});
