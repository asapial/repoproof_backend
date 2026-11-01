import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { executeOwnedSmoke, oneCreateFetch, vercelSmokeProvider, type SmokeProvider, type SmokeSandbox } from "./adapter";
import { loadOwnedFixture, validateFixture, type FixtureFile } from "./fixture";
import { smokeConfig, type SmokeConfig } from "./policy";
import { runAdminOwnedFixtureSmoke } from "./admin";

const config: SmokeConfig = { enabled: true, adminId: "owned-admin", projectId: "prj_owned", teamId: "team_owned", token: "synthetic-sdk-secret", image: `registry.vercel.com/owned/node@sha256:${"a".repeat(64)}`, nodeVersion: "v24.22.2", databaseUrl: "postgresql://synthetic@localhost/disposable" };
let files: FixtureFile[];
beforeAll(async () => { files = await loadOwnedFixture(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function harness() {
  const exits = [0, 0, 1, 0, 0];
  const instance: SmokeSandbox = { persistent: false,
    writeFiles: vi.fn(async () => {}), runCommand: vi.fn(async () => ({ exitCode: exits.shift() ?? 0 })),
    stop: vi.fn(async () => ({ status: "stopped" })),
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
    for (const override of [{ SANDBOX_IMAGE: "vercel/sandbox/node:24" }, { SANDBOX_PROJECT_ID: "*" }, { SANDBOX_NODE_VERSION: "node24" }]) expect(() => smokeConfig({ ...env, ...override })).toThrow();
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
    expect(await h.run()).toEqual({ status: "SMOKE_FINISHED", cleanupConfirmed: true, commands: 5 });
    expect(h.provider.create.mock.calls[0]![0]).toEqual({ token: config.token, teamId: config.teamId, projectId: config.projectId,
      image: config.image, timeout: 30000, resources: { vcpus: 1 }, persistent: false, networkPolicy: "deny-all", env: {}, ports: [], signal: expect.any(AbortSignal) });
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
});
