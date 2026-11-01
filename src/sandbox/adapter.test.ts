import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { executeOwnedSmoke, oneCreateFetch, vercelSmokeProvider, type SmokeProvider, type SmokeSandbox, type CommandOptions } from "./adapter";
import { loadOwnedFixture, validateFixture, type FixtureFile } from "./fixture";
import { smokeConfig, type SmokeConfig } from "./policy";
import { runAdminOwnedFixtureSmoke } from "./admin";
import { Sandbox } from "@vercel/sandbox";
import { hash, smokeReceiptSchema } from "./receipt";

const config: SmokeConfig = { enabled: true, adminId: "owned-admin", projectId: "prj_owned", teamId: "team_owned", token: "synthetic-sdk-secret", image: `registry.vercel.com/owned/node@sha256:${"a".repeat(64)}`, nodeVersion: "v24.22.2", databaseUrl: "postgresql://synthetic@localhost/disposable" };
let files: FixtureFile[];
beforeAll(async () => { files = await loadOwnedFixture(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function harness() {
  const exits = [0, 0, 1, 0, 0];
  const instance: SmokeSandbox = { persistent: false,
    observe: vi.fn(() => ({ sandboxName: "offline-owned", sessionId: "offline-session", image: config.image, networkPolicy: "deny-all", persistent: false, vcpus: 1, memoryMb: 2048, timeoutMs: 30000, createdAt: new Date().toISOString() })),
    writeFiles: vi.fn(async () => {}), runCommand: vi.fn(async () => ({ exitCode: exits.shift() ?? 0 })),
    stop: vi.fn(async () => ({ status: "stopped", sessionId: "offline-session", snapshotCreated: false })),
  };
  const provider = { create: vi.fn(async (options: Parameters<SmokeProvider["create"]>[0]) => { void options; return instance; }) } satisfies SmokeProvider;
  const control = { claim: vi.fn(async () => true), finish: vi.fn(async () => {}) };
  return { instance, provider, control, run: (signal?: AbortSignal) => executeOwnedSmoke(config, config.adminId, files, control, provider, signal) };
}

describe("owned Sandbox offline control (no fixture execution)", () => {
  it("is disabled without provider configuration and never imports application auth", async () => {
    vi.stubEnv("SANDBOX_SMOKE_ENABLED", "false");
    expect(smokeConfig({})).toBeNull();
    expect(await runAdminOwnedFixtureSmoke(new Headers())).toEqual({ status: "DISABLED" });
  });
  it("rejects incomplete configuration without disclosing secret values", () => {
    expect(() => smokeConfig({ SANDBOX_SMOKE_ENABLED: "true", SANDBOX_TOKEN: "do-not-log" })).toThrow(/^Invalid sandbox configuration$/);
    expect(() => smokeConfig({ SANDBOX_SMOKE_ENABLED: "TRUE" })).toThrow();
  });
  it("requires exact project, immutable image and supported exact runtime", () => {
    const env = { SANDBOX_SMOKE_ENABLED: "true", SANDBOX_ADMIN_USER_ID: config.adminId, SANDBOX_TOKEN: config.token,
      SANDBOX_TEAM_ID: config.teamId, SANDBOX_PROJECT_ID: config.projectId, SANDBOX_IMAGE: config.image,
      SANDBOX_NODE_VERSION: config.nodeVersion, SANDBOX_CONTROL_DATABASE_URL: config.databaseUrl };
    expect(smokeConfig(env)).toEqual(config);
    for (const override of [{ SANDBOX_IMAGE: "vercel/sandbox/node:24" }, { SANDBOX_PROJECT_ID: "*" }, { SANDBOX_NODE_VERSION: "node24" }, { DEBUG_FETCH: "true" }]) expect(() => smokeConfig({ ...env, ...override })).toThrow();
  });
  it("rejects non-admin and already cancelled requests before consuming permission", async () => {
    const h = harness();
    const abort = new AbortController(); abort.abort();
    expect((await executeOwnedSmoke(config, "ordinary-user", files, h.control, h.provider)).status).toBe("UNAVAILABLE");
    expect((await h.run(abort.signal)).status).toBe("UNAVAILABLE");
    expect(h.control.claim).not.toHaveBeenCalled(); expect(h.provider.create).not.toHaveBeenCalled();
  });
  it("rejects changed bytes, extra paths, duplicate paths and oversized files", async () => {
    const h = harness();
    const mutated = files.map(file => ({ ...file, content: Buffer.from(file.content) })); mutated[0]!.content[0] = mutated[0]!.content[0]! ^ 1;
    await expect(executeOwnedSmoke(config, config.adminId, mutated, h.control, h.provider)).rejects.toThrow("Fixture integrity failed");
    expect(() => validateFixture([...files, { path: "../secret", content: Buffer.from("x") }])).toThrow();
    expect(() => validateFixture([files[0]!, files[0]!, files[2]!])).toThrow();
    expect(() => validateFixture([{ path: files[0]!.path, content: Buffer.alloc(32769) }, ...files.slice(1)])).toThrow();
    expect(h.control.claim).not.toHaveBeenCalled();
  });
  it("fails closed when shared quota is exhausted, missing or unavailable", async () => {
    const h = harness(); h.control.claim.mockResolvedValue(false);
    expect((await h.run()).status).toBe("UNAVAILABLE");
    h.control.claim.mockRejectedValue(new Error("secret-database-url"));
    expect((await h.run()).status).toBe("UNAVAILABLE"); expect(h.provider.create).not.toHaveBeenCalled();
  });
  it("uses deny-all, nonpersistent 1CPU/2GiB, no ports/source/mounts or application env", async () => {
    const h = harness();
    expect(await h.run()).toMatchObject({ status: "SMOKE_FINISHED", cleanupConfirmed: true, commands: 5 });
    expect(h.provider.create.mock.calls[0]![0]).toEqual({ token: config.token, teamId: config.teamId, projectId: config.projectId,
      image: config.image, timeout: 30000, resources: { vcpus: 1 }, persistent: false, networkPolicy: "deny-all", env: {}, ports: [], mounts: {}, signal: expect.any(AbortSignal) });
    expect(h.instance.writeFiles).toHaveBeenCalledWith(files.map(file => ({ ...file, path: `/vercel/sandbox/${file.path}` })), expect.anything());
    const calls = vi.mocked(h.instance.runCommand).mock.calls;
    expect(calls[2]![0].args).toEqual(["--test", "tests/issue.mjs"]);
    expect(calls[3]![0].args).toEqual(["--test", "tests/regression.mjs"]);
    for (const [call] of calls) expect(call).toMatchObject({ cmd: "node", sudo: false, timeoutMs: 5000, env: {}, cwd: "/vercel/sandbox" });
    expect(h.instance.stop).toHaveBeenCalledTimes(1); expect(h.control.finish).toHaveBeenCalledWith(true);
  });
  it("always stops on upload, runtime, digest and command errors without leaking them", async () => {
    for (const mode of ["upload", "runtime", "command"] as const) {
      const h = harness();
      if (mode === "upload") vi.mocked(h.instance.writeFiles).mockRejectedValue(new Error("sensitive-provider-output"));
      else if (mode === "runtime") vi.mocked(h.instance.runCommand).mockResolvedValue({ exitCode: 43 });
      else vi.mocked(h.instance.runCommand).mockRejectedValue(new Error("sensitive-provider-output"));
      expect(await h.run()).toMatchObject({ status: "SMOKE_FAILED", cleanupConfirmed: true }); expect(h.instance.stop).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects provider persistence mismatch and confirms shutdown", async () => {
    const h = harness(); h.instance.persistent = true;
    expect((await h.run()).status).toBe("SMOKE_FAILED"); expect(h.instance.writeFiles).not.toHaveBeenCalled(); expect(h.instance.stop).toHaveBeenCalledTimes(1);
  });
  it("cancels a hung command and uses a fresh cleanup signal", async () => {
    const h = harness(); const abort = new AbortController();
    vi.mocked(h.instance.runCommand).mockImplementation(async () => { abort.abort(); return new Promise(() => {}); });
    expect((await h.run(abort.signal)).status).toBe("CANCELLED");
    expect(vi.mocked(h.instance.stop).mock.calls[0]![0].signal.aborted).toBe(false);
  });
  it("cleans a late create after cancellation, leaving permission consumed", async () => {
    const h = harness(); const abort = new AbortController();
    let resolveCreate!: (sandbox: SmokeSandbox) => void;
    h.provider.create.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; abort.abort(); }));
    expect((await h.run(abort.signal)).status).toBe("CLEANUP_UNCONFIRMED");
    resolveCreate(h.instance); await vi.waitFor(() => expect(h.instance.stop).toHaveBeenCalledTimes(1));
    expect(h.control.claim).toHaveBeenCalledTimes(1); expect(h.instance.runCommand).not.toHaveBeenCalled();
  });
  it("bounds output and discards raw content", async () => {
    const h = harness();
    vi.mocked(h.instance.runCommand).mockImplementation(async options => { options.stdout.write(Buffer.alloc(16385, "s")); return { exitCode: 0 }; });
    const result = await h.run();
    expect(result.status).toBe("SMOKE_FAILED"); expect(JSON.stringify(result)).not.toContain("sss"); expect(h.instance.stop).toHaveBeenCalledTimes(1);
  });
  it("fails closed on stop failure or unknown stop state", async () => {
    for (const rejects of [true, false]) {
      const h = harness();
      if (rejects) vi.mocked(h.instance.stop).mockRejectedValue(new Error("secret-token"));
      else vi.mocked(h.instance.stop).mockResolvedValue({ status: "stopping" });
      expect(await h.run()).toMatchObject({ status: "CLEANUP_UNCONFIRMED", cleanupConfirmed: false }); expect(h.control.finish).toHaveBeenCalledWith(false);
    }
  });
  it("bounds execution and cleanup even when SDK ignores AbortSignal", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
    const h = harness(); vi.mocked(h.instance.runCommand).mockImplementation(() => new Promise(() => {}));
    const operation = h.run(); await vi.advanceTimersByTimeAsync(20001);
    expect(await operation).toMatchObject({ status: "TIMED_OUT", cleanupConfirmed: true });
    const hung = harness(); vi.mocked(hung.instance.stop).mockImplementation(() => new Promise(() => {}));
    const cleanup = hung.run(); await vi.advanceTimersByTimeAsync(5001);
    expect((await cleanup).status).toBe("CLEANUP_UNCONFIRMED");
  });
  it("does not claim successful cleanup when durable completion update fails", async () => {
    const h = harness(); h.control.finish.mockRejectedValue(new Error("database-password"));
    expect((await h.run()).status).toBe("CLEANUP_UNCONFIRMED");
  });
  it("sends only one actual SDK create even when the SDK retries a 500 response", async () => {
    const transport = vi.fn(async () => new Response('{"error":{"message":"Synthetic failure"}}', { status: 500 }));
    vi.stubGlobal("fetch", transport);
    await expect(vercelSmokeProvider.create({ token: config.token, projectId: config.projectId, teamId: config.teamId,
      image: config.image, persistent: false, networkPolicy: "deny-all", timeout: 30000, resources: { vcpus: 1 } })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not block cleanup calls while blocking another creation after a network error", async () => {
    const transport = vi.fn(async () => { throw new Error("uncertain create"); });
    const guarded = oneCreateFetch(transport);
    await expect(guarded("https://api.vercel.com/v3/sandboxes", { method: "POST" })).rejects.toThrow();
    expect((await guarded("https://api.vercel.com/v3/sandboxes", { method: "POST" })).status).toBe(409);
    await expect(guarded("https://api.vercel.com/v2/sandboxes/owned/stop", { method: "POST" })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("captures identity, timestamps, command hashes/exits and redacted per-stream hashes", async () => {
    const h = harness();
    vi.mocked(h.instance.runCommand).mockImplementation(async options => {
      options.stdout.write(config.token); options.stderr.write("owned-error-stream");
      return { exitCode: options.args.includes("tests/issue.mjs") ? 1 : 0 };
    });
    const result = await h.run(); const receipt = smokeReceiptSchema.parse(result.receipt);
    expect(result.status).toBe("SMOKE_FINISHED"); expect(receipt.trust).toBe("UNVERIFIED_SDK_OBSERVATION");
    expect(receipt.provider).toMatchObject({ sessionId: "offline-session", persistent: false, networkPolicy: "deny-all", vcpus: 1, memoryMb: 2048 });
    expect(receipt.commands.map(command => command.exitCode)).toEqual([0,0,1,0,0]);
    expect(receipt.commands.map(command => command.commandId)).toEqual(["runtime","hash_before","issue","regressions","hash_after"]);
    expect(receipt.commands[0]).toMatchObject({ stdoutSha256: hash(config.token), stdoutBytes: Buffer.byteLength(config.token), stderrSha256: hash("owned-error-stream") });
    expect(receipt.cleanup).toMatchObject({ status: "STOPPED", snapshotCreated: false });
    expect(Date.parse(receipt.finishedAt)).toBeGreaterThanOrEqual(Date.parse(receipt.startedAt));
    expect(JSON.stringify(receipt)).not.toContain(config.token); expect(JSON.stringify(receipt)).not.toContain("owned-error-stream");
  });
  it("rejects mismatched policy/resources or secret-bearing metadata before upload", async () => {
    for (const override of [{ networkPolicy: "allow-all" }, { vcpus: 2 }, { memoryMb: 4096 }, { persistent: true }, { timeoutMs: 60000 }, { sessionId: config.token }]) {
      const h = harness(); const observation = h.instance.observe(); vi.mocked(h.instance.observe).mockReturnValue({ ...observation as object, ...override });
      expect((await h.run()).status).not.toBe("SMOKE_FINISHED"); expect(h.instance.writeFiles).not.toHaveBeenCalled(); expect(h.instance.stop).toHaveBeenCalledTimes(1);
    }
  });
  it("does not confirm cleanup for another session or an unexpected snapshot", async () => {
    for (const override of [{ sessionId: "different-session" }, { snapshotCreated: true }]) {
      const h = harness(); vi.mocked(h.instance.stop).mockResolvedValue({ status: "stopped", sessionId: "offline-session", snapshotCreated: false, ...override });
      const result = await h.run(); expect(result.status).toBe("CLEANUP_UNCONFIRMED"); expect(result.receipt?.cleanup.status).toBe("UNKNOWN"); expect(h.control.finish).toHaveBeenCalledWith(false);
    }
  });
  it("retains partial command receipt on abort without inventing an exit code", async () => {
    const h = harness(); const abort = new AbortController();
    vi.mocked(h.instance.runCommand).mockImplementation(async () => { abort.abort(); return new Promise(() => {}); });
    const result = await h.run(abort.signal); expect(result.status).toBe("CANCELLED"); expect(result.receipt?.commands).toHaveLength(1); expect(result.receipt?.commands[0]?.exitCode).toBeNull();
  });
  it("pins SDK file/command/stop calls to the original session without parent resume", async () => {
    const session = { sessionId: "offline-session", networkPolicy: "deny-all", vcpus: 1, memory: 2048, timeout: 30000, createdAt: new Date(),
      writeFiles: vi.fn(async () => {}), runCommand: vi.fn(async (options: CommandOptions) => ({ exitCode: options.args.includes("tests/issue.mjs") ? 1 : 0 })), stop: vi.fn(async () => ({ session: { status: "stopped", id: "offline-session" } })) };
    const sdk = { persistent: false, name: "offline-owned", image: config.image, currentSession: vi.fn(() => session),
      writeFiles: vi.fn(), runCommand: vi.fn(), stop: vi.fn() };
    vi.spyOn(Sandbox, "create").mockResolvedValue(sdk as unknown as Awaited<ReturnType<typeof Sandbox.create>>);
    const h = harness(); const result = await executeOwnedSmoke(config, config.adminId, files, h.control, vercelSmokeProvider);
    expect(result.status).toBe("SMOKE_FINISHED"); expect(sdk.currentSession).toHaveBeenCalledTimes(1);
    expect(session.writeFiles).toHaveBeenCalledTimes(1); expect(session.runCommand).toHaveBeenCalledTimes(5); expect(session.stop).toHaveBeenCalledTimes(1); expect(sdk.writeFiles).not.toHaveBeenCalled(); expect(sdk.runCommand).not.toHaveBeenCalled(); expect(sdk.stop).not.toHaveBeenCalled();
  });
});
