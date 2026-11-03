import { afterEach, describe, expect, it, vi } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { executeHarmlessSmoke, harmlessEffectFetch, harmlessLimits, harmlessScripts, harmlessSdkProvider, type HarmlessConfig, type HarmlessControl, type HarmlessInstance, type HarmlessProvider } from "./harmless";

const config: HarmlessConfig = { name: "rpf-harmless-offline-v1", teamId: "team_owned", projectId: "prj_owned", token: "synthetic-harmless-secret-only" };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function harness() {
  const metadata = { name: config.name, sessionId: "offline-session", image: harmlessLimits.image, networkPolicy: "deny-all", persistent: false, vcpus: 1, memoryMb: 2048, timeoutMs: 45000, mountCount: 0, currentSnapshot: null };
  const instance: HarmlessInstance = { observe: vi.fn(() => metadata), run: vi.fn(async (kind, stdout) => {
    if (kind === "identity") stdout.write(JSON.stringify({ marker: "RPF_HARMLESS_V1", node: "v24.22.2", platform: "linux", arch: "x64" }) + "\n");
    return { commandId: "offline-" + kind, exitCode: kind === "identity" ? 0 : 137, durationMs: kind === "identity" ? 24 : 510 };
  }), cancel: vi.fn(async () => ({ commandId: "offline-cancel", exitCode: 137, durationMs: 70 })), stop: vi.fn(async () => ({ sessionId: "offline-session", status: "stopped", snapshotCreated: false })) };
  const provider: HarmlessProvider = { create: vi.fn(async () => instance) };
  const control = { claim: vi.fn<HarmlessControl["claim"]>(async () => true), record: vi.fn<HarmlessControl["record"]>(async () => {}) };
  return { metadata, instance, provider, control, run: (signal?: AbortSignal) => executeHarmlessSmoke(config, control, provider, signal) };
}
describe("harmless Sandbox operator boundary — synthetic transports only", () => {
  it("consumes authority before create, fixes resources/commands and emits no verdict, fixture or credentials", async () => {
    const h = harness(), receipt = await h.run(); expect(receipt.status).toBe("COMPLETE"); expect(receipt.cleanup.confirmed).toBe(true);
    expect(h.control.claim.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.provider.create).mock.invocationCallOrder[0]!);
    const options = vi.mocked(h.provider.create).mock.calls[0]![0]!;
    expect(options).toMatchObject({ image: harmlessLimits.image, resources: { vcpus: 1 }, timeout: 45000, persistent: false, networkPolicy: "deny-all", ports: [], env: {}, mounts: {} });
    expect(options).not.toHaveProperty("source"); expect(Object.isFrozen(options.resources)).toBe(true); expect(Object.isFrozen(options.ports)).toBe(true);
    expect(receipt.commands.map(command => [command.kind, command.exitCode])).toEqual([["identity",0],["deadline",137],["cancellation",137]]);
    expect(receipt.rpf004Complete).toBe(false); expect(receipt.fixtureExecutions).toBe(0); expect(receipt).not.toHaveProperty("verdict"); expect(JSON.stringify(receipt)).not.toContain(config.token);
  });
  it("has no effect when permission is absent, admission fails or caller is cancelled", async () => {
    for (const failure of ["denied", "rejected", "cancelled"] as const) {
      const h = harness(); if (failure === "denied") h.control.claim.mockResolvedValue(false); if (failure === "rejected") h.control.claim.mockRejectedValue(new Error("private"));
      const signal = AbortSignal.abort(); expect((await h.run(failure === "cancelled" ? signal : undefined)).status).toBe("UNAVAILABLE"); expect(h.provider.create).not.toHaveBeenCalled();
    }
  });
  it("bounds stalled admission before creating anything", async () => {
    const h = harness(); h.control.claim.mockImplementation(() => new Promise(() => {}));
    expect((await h.run()).status).toBe("UNAVAILABLE"); expect(h.provider.create).not.toHaveBeenCalled();
  }, 7000);
  it("cancels an outstanding admission without waiting for its storage callback", async () => {
    const h = harness(), abort = new AbortController(); h.control.claim.mockImplementation(() => new Promise(() => {}));
    const pending = h.run(abort.signal); abort.abort(); expect((await pending).status).toBe("UNAVAILABLE"); expect(h.provider.create).not.toHaveBeenCalled();
  });
  it.each([{ persistent: true }, { networkPolicy: "allow-all" }, { vcpus: 2 }, { memoryMb: 4096 }, { mountCount: 1 }, { currentSnapshot: "snapshot" }, { image: "unapproved/image" }, { name: "different" }])("stops a policy mismatch before command execution: %j", async override => {
    const h = harness(); vi.mocked(h.instance.observe).mockReturnValue({ ...h.metadata, ...override }); expect((await h.run()).status).toBe("CLEANUP_UNKNOWN"); expect(h.instance.run).not.toHaveBeenCalled(); expect(h.instance.stop).toHaveBeenCalledTimes(1);
  });
  it.each([{ exitCode: null }, { durationMs: undefined }, { durationMs: NaN }, { durationMs: -1 }, { commandId: "../escape" }])("rejects missing/invalid command evidence: %j", async invalid => {
    const h = harness(); vi.mocked(h.instance.run).mockResolvedValue({ commandId: "offline", exitCode: 0, durationMs: 1, ...invalid }); const receipt = await h.run(); expect(receipt.status).toBe("FAILED"); expect(receipt.cleanup.confirmed).toBe(true); expect(h.instance.cancel).not.toHaveBeenCalled();
  });
  it("requires deadline and cancellation to kill the command before its natural exit", async () => {
    for (const kind of ["deadline", "cancellation"] as const) {
      const h = harness(); if (kind === "deadline") vi.mocked(h.instance.run).mockImplementation(async (value, out) => {
        if (value === "identity") out.write(JSON.stringify({ marker: "RPF_HARMLESS_V1", node: "v24.22.2", platform: "linux", arch: "x64" }));
        return { commandId: "offline", exitCode: 0, durationMs: 10000 };
      }); else vi.mocked(h.instance.cancel).mockResolvedValue({ commandId: "offline-cancel", exitCode: 0, durationMs: 10000 });
      expect((await h.run()).status).toBe("FAILED"); expect(h.instance.stop).toHaveBeenCalledTimes(1);
    }
  });
  it("bounds output and discards malformed identity or diagnostics", async () => {
    for (const output of ["x".repeat(2049), '{"marker":"RPF_HARMLESS_V1","private":"do-not-log"}', '{"marker":"RPF_HARMLESS_V1","node":"v26.1.0","platform":"linux","arch":"x64"}']) {
      const h = harness(); vi.mocked(h.instance.run).mockImplementation(async (_kind, stdout) => { stdout.write(output); return { commandId: "offline", exitCode: 0, durationMs: 1 }; });
      const receipt = await h.run(); expect(receipt.status).toBe("FAILED"); expect(receipt.cleanup.confirmed).toBe(true); expect(JSON.stringify(receipt)).not.toContain("do-not-log");
    }
  });
  it("uses a fresh cleanup signal after actual caller cancellation", async () => {
    const h = harness(), abort = new AbortController(); vi.mocked(h.instance.run).mockImplementation(async () => { abort.abort(); throw new Error("cancelled"); });
    const receipt = await h.run(abort.signal); expect(receipt.status).toBe("FAILED"); expect(receipt.cleanup.confirmed).toBe(true);
    expect(vi.mocked(h.instance.stop).mock.calls[0]![0].aborted).toBe(false);
  });
  it.each([{ sessionId: "different", status: "stopped", snapshotCreated: false }, { sessionId: "offline-session", status: "running", snapshotCreated: false }, { sessionId: "offline-session", status: "stopped", snapshotCreated: true }])("never confirms contradictory cleanup: %j", async stopped => {
    const h = harness(); vi.mocked(h.instance.stop).mockResolvedValue(stopped); expect((await h.run()).status).toBe("CLEANUP_UNKNOWN");
  });
  it("does not return unrecorded success or rearm after a ledger failure", async () => {
    const h = harness(); h.control.record.mockRejectedValueOnce(new Error("storage failure")); expect((await h.run()).status).toBe("UNAVAILABLE"); expect(h.provider.create).not.toHaveBeenCalled();
    const other = harness(); other.control.record.mockImplementation(async event => { if (event.stage === "CLEANUP") throw new Error("unknown ack"); }); expect((await other.run()).status).toBe("CLEANUP_UNKNOWN");
  });
});
describe("harmless SDK and transport", () => {
  it("uses the installed SDK origin without sending an unreviewed host or leaking credentials", async () => {
    const transport = vi.fn(async () => new Response('{"error":{"message":"Synthetic offline rejection"}}', { status: 400 }));
    await expect(Sandbox.create({ name: config.name, image: harmlessLimits.image, resources: { vcpus: 1 }, timeout: 45000, persistent: false, networkPolicy: "deny-all", ports: [], env: {}, mounts: {}, token: config.token, teamId: config.teamId, projectId: config.projectId, fetch: harmlessEffectFetch(transport), signal: AbortSignal.timeout(5000) })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    const [input, init] = transport.mock.calls[0]! as unknown as Parameters<typeof fetch>;
    const url = new URL(String(input)); expect(url.origin).toBe("https://vercel.com"); expect(url.pathname).toBe("/api/v3/sandboxes");
    expect(init).toMatchObject({ method: "POST", redirect: "error" }); expect(String(init?.body)).not.toContain(config.token);
  });
  it("deduplicates creates across the two fixed official API origins and rejects adjacent paths", async () => {
    const transport = vi.fn(async () => new Response("{}")), guarded = harmlessEffectFetch(transport);
    expect((await guarded("https://api.vercel.com/v3/sandboxes", { method: "POST", body: "{}" })).status).toBe(200);
    expect((await guarded("https://vercel.com/api/v3/sandboxes", { method: "POST", body: '{"name":"different"}' })).status).toBe(409);
    for (const url of ["https://vercel.com/v3/sandboxes", "https://vercel.com/api/api/v3/sandboxes", "https://vercel.com/api/v3/projects", "https://evil.example/api/v3/sandboxes"]) await expect(guarded(url)).rejects.toThrow("denied");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("blocks uncertain create and command retries, cross-origin calls and non-POST mutations", async () => {
    const transport = vi.fn(async () => new Response("{}")), guarded = harmlessEffectFetch(transport);
    for (const path of ["/v3/sandboxes", "/v2/sandboxes/sessions/s1/cmd"]) {
      expect((await guarded("https://api.vercel.com" + path, { method: "POST", body: "{}" })).status).toBe(200);
      expect((await guarded("https://api.vercel.com" + path, { method: "POST", body: "{}" })).status).toBe(409);
    }
    await expect(guarded("https://evil.example/v2/sandboxes")).rejects.toThrow("denied"); await expect(guarded("https://api.vercel.com/v2/sandboxes/x", { method: "DELETE" })).rejects.toThrow("denied"); expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does not resend a create whose response was lost", async () => {
    const transport = vi.fn(async () => { throw new Error("network outcome unknown"); }), guarded = harmlessEffectFetch(transport);
    await expect(guarded("https://api.vercel.com/v3/sandboxes", { method: "POST", body: "{}" })).rejects.toThrow();
    expect((await guarded("https://api.vercel.com/v3/sandboxes", { method: "POST", body: '{"name":"different"}' })).status).toBe(409); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("independently reads raw command state and pins stop to the initial session", async () => {
    const observed = { cmdId: "cmd_identity", exitCode: null, durationMs: 1 }, finished = { cmdId: "cmd_identity", exitCode: 0 };
    const session = { getCommand: vi.fn(async () => observed), runCommand: vi.fn(async () => finished), stop: vi.fn(async () => ({ session: { id: "s1", status: "stopped" } })) };
    vi.spyOn(Sandbox, "create").mockResolvedValue({ currentSession: vi.fn(() => session), stop: vi.fn() } as unknown as Awaited<ReturnType<typeof Sandbox.create>>);
    const instance = await harmlessSdkProvider.create({ image: harmlessLimits.image });
    const sink = new (await import("node:stream")).Writable({ write(_chunk, _encoding, done) { done(); } });
    await expect(instance.run("identity", sink, sink, new AbortController().signal)).rejects.toThrow("unconfirmed");
    expect((await instance.stop(new AbortController().signal)).sessionId).toBe("s1"); expect(session.stop).toHaveBeenCalledTimes(1); expect(harmlessScripts.identity).not.toMatch(/process\.env|readFile|fetch\(/);
  });
  it("observes the finished cancellation handle rather than its pending predecessor", async () => {
    const finished = { cmdId: "cmd_cancel", exitCode: 137, durationMs: 40 };
    const pending = { cmdId: "cmd_cancel", exitCode: null, kill: vi.fn(async () => {}), wait: vi.fn(async () => finished) };
    const session = { runCommand: vi.fn(async () => pending), getCommand: vi.fn(async () => finished), stop: vi.fn(async () => ({ session: { id: "s1", status: "stopped" } })) };
    const currentSession = vi.fn(() => session); vi.spyOn(Sandbox, "create").mockResolvedValue({ currentSession } as unknown as Awaited<ReturnType<typeof Sandbox.create>>);
    const instance = await harmlessSdkProvider.create({ image: harmlessLimits.image }), signal = new AbortController().signal;
    expect((await instance.cancel(signal)).exitCode).toBe(137); expect(pending.kill).toHaveBeenCalledWith("SIGKILL", { abortSignal: signal });
    await instance.stop(signal); expect(currentSession).toHaveBeenCalledTimes(1);
  });
});
