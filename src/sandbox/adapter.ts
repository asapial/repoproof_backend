import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { fixtureDigests, validateFixture, type FixtureFile } from "./fixture";
import { smokeLimits, type SmokeConfig } from "./policy";
import type { SmokeControl } from "./control";
import { hash, newSmokeReceipt, sanitizeSmokeObservation, smokeReceiptSchema, type SmokeCommandReceipt, type SmokeReceipt } from "./receipt";

type CreateOptions = Parameters<typeof Sandbox.create>[0];
export type CommandOptions = { cmd: string; args: string[]; cwd: string; env: Record<string, string>; sudo: false; timeoutMs: number; signal: AbortSignal; stdout: Writable; stderr: Writable };
export interface SmokeSandbox {
  persistent: boolean;
  observe(): unknown;
  writeFiles(files: FixtureFile[], opts: { signal: AbortSignal }): Promise<unknown>;
  runCommand(options: CommandOptions): Promise<{ exitCode: number }>;
  stop(opts: { signal: AbortSignal }): Promise<{ status: string; sessionId?: string; snapshotCreated?: boolean }>;
}
export type SmokeProvider = { create(options: CreateOptions): Promise<SmokeSandbox> };
// SDK 3.9.1 retries POST create on network/5xx errors. Do not send a second
// creation when the first response is uncertain. Other control calls may retry.
export function oneCreateFetch(transport: typeof fetch = globalThis.fetch): typeof fetch {
  let sent = false;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST" && /^(?:\/api)?\/v[23]\/sandboxes$/.test(url.pathname)) {
      if (sent) return new Response('{"error":{"message":"Create retry denied"}}', { status: 409 });
      sent = true;
    }
    return transport(input, init);
  };
}
export const vercelSmokeProvider: SmokeProvider = { create: async options => {
  const sandbox = await Sandbox.create({ ...options, fetch: oneCreateFetch() });
  let session: ReturnType<typeof sandbox.currentSession> | undefined;
  // Read metadata inside adapter's try/finally. A metadata failure must still
  // leave a stop handle. Pin command calls to one VM; never auto-resume a parent.
  return { get persistent() { return sandbox.persistent; }, observe() {
    session ??= sandbox.currentSession();
    return { sandboxName: sandbox.name, sessionId: session.sessionId, image: sandbox.image, networkPolicy: typeof session.networkPolicy === "string" ? session.networkPolicy : "custom",
      persistent: sandbox.persistent, vcpus: session.vcpus, memoryMb: session.memory, timeoutMs: session.timeout, createdAt: session.createdAt.toISOString() };
  }, writeFiles: (files, opts) => (session ?? sandbox.currentSession()).writeFiles(files, opts),
  runCommand: options => (session ?? sandbox.currentSession()).runCommand(options),
  stop: async opts => {
    if (session) { const result = await session.stop(opts); return { status: result.session.status, sessionId: result.session.id, snapshotCreated: Boolean(result.snapshot) }; }
    const result = await sandbox.stop(opts); return { status: result.status, sessionId: result.id, snapshotCreated: Boolean(result.snapshot) };
  } };
} };
export type SmokeStatus = "SMOKE_FINISHED" | "SMOKE_FAILED" | "CANCELLED" | "TIMED_OUT" | "CLEANUP_UNCONFIRMED" | "UNAVAILABLE";
export type SmokeResult = { status: SmokeStatus; cleanupConfirmed: boolean; commands: number; receipt?: SmokeReceipt };
const remoteDigestCheck = `const fs=require('node:fs'),c=require('node:crypto');const expected=${JSON.stringify(fixtureDigests)};for(const [p,h] of Object.entries(expected)){if(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)process.exit(42);}`;

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  void promise.catch(() => {});
  signal.throwIfAborted();
  let rejectAbort: (() => void) | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error("Sandbox operation aborted"));
      signal.addEventListener("abort", rejectAbort, { once: true });
    })]);
  } finally { if (rejectAbort) signal.removeEventListener("abort", rejectAbort); }
}

export async function executeOwnedSmoke(config: SmokeConfig, adminId: string, files: FixtureFile[], control: SmokeControl, provider: SmokeProvider = vercelSmokeProvider, cancellation?: AbortSignal): Promise<SmokeResult> {
  // Defense in depth: even an internal caller cannot select an ordinary user.
  if (adminId !== config.adminId || !config.enabled || cancellation?.aborted) return { status: "UNAVAILABLE", cleanupConfirmed: false, commands: 0 };
  const upload = validateFixture(files).map(file => ({ ...file, path: `/vercel/sandbox/${file.path}` }));
  try { if (!(await control.claim(config, adminId))) return { status: "UNAVAILABLE", cleanupConfirmed: false, commands: 0 }; }
  catch { return { status: "UNAVAILABLE", cleanupConfirmed: false, commands: 0 }; }
  const receipt = newSmokeReceipt(config.image);
  const deadline = AbortSignal.timeout(smokeLimits.operationMs);
  const controller = new AbortController();
  const signal = AbortSignal.any([deadline, controller.signal, ...(cancellation ? [cancellation] : [])]);
  let sandbox: SmokeSandbox | undefined;
  let cleanupConfirmed = false;
  let commands = 0;
  let status: SmokeStatus = "SMOKE_FAILED";
  let stopPromise: Promise<void> | undefined;
  const cleanup = (instance: SmokeSandbox): Promise<void> => {
    stopPromise ??= (async () => {
      receipt.cleanup.attemptedAt = new Date().toISOString(); receipt.cleanup.status = "UNKNOWN";
      if (receipt.provider === null) {
        try { receipt.provider = sanitizeSmokeObservation(instance.observe(), config.image, [config.token, config.databaseUrl]); } catch { /* Still stop; unknown identity cannot prove cleanup. */ }
      }
      const cleanupSignal = AbortSignal.timeout(smokeLimits.cleanupMs);
      try {
        const stopped = await bounded(instance.stop({ signal: cleanupSignal }), cleanupSignal);
        const sameSession = receipt.provider !== null && stopped.sessionId === receipt.provider.sessionId;
        cleanupConfirmed = stopped.status === "stopped" && sameSession && stopped.snapshotCreated === false;
        receipt.cleanup.snapshotCreated = stopped.snapshotCreated ?? null;
        if (cleanupConfirmed) { receipt.cleanup.status = "STOPPED"; receipt.cleanup.acknowledgedAt = new Date().toISOString(); }
      } catch { cleanupConfirmed = false; }
    })();
    return stopPromise;
  };
  let outputBytes = 0;
  try {
    const creation = provider.create({ token: config.token, projectId: config.projectId, teamId: config.teamId,
      image: config.image, resources: { vcpus: smokeLimits.vcpus }, timeout: smokeLimits.lifetimeMs,
      persistent: false, networkPolicy: "deny-all", ports: [], env: {}, mounts: {}, signal });
    // If cancellation wins creation, clean a late result too. Permission stays
    // consumed even if provider ignores cancellation or the host is terminated.
    void creation.then(instance => { if (signal.aborted) return cleanup(instance); }).catch(() => {});
    sandbox = await bounded(creation, signal);
    if (sandbox.persistent !== false) throw new Error("Sandbox policy mismatch");
    receipt.provider = sanitizeSmokeObservation(sandbox.observe(), config.image, [config.token, config.databaseUrl]);
    if (receipt.provider.networkPolicy !== "deny-all" || receipt.provider.persistent || receipt.provider.vcpus !== 1 || receipt.provider.memoryMb !== 2048 || receipt.provider.timeoutMs !== smokeLimits.lifetimeMs) throw new Error("Sandbox policy mismatch");
    await bounded(sandbox.writeFiles(upload, { signal }), signal);
    const run = async (commandId: SmokeCommandReceipt["commandId"], args: string[]) => {
      const startedAt = new Date().toISOString(); const stdoutHash = createHash("sha256"); const stderrHash = createHash("sha256");
      let stdoutBytes = 0; let stderrBytes = 0; let exitCode: number | null = null;
      const sink = (stderr: boolean) => new Writable({ write(chunk: Buffer, _encoding, done) {
        outputBytes += chunk.length; if (stderr) { stderrBytes += chunk.length; stderrHash.update(chunk); } else { stdoutBytes += chunk.length; stdoutHash.update(chunk); }
        if (outputBytes > smokeLimits.outputBytes) controller.abort(); done();
      } }).on("error", () => controller.abort());
      const stdout = sink(false); const stderr = sink(true);
      try {
        const result = await bounded(sandbox!.runCommand({ cmd: "node", args, cwd: "/vercel/sandbox", env: {}, sudo: false,
          timeoutMs: 5_000, stdout, stderr, signal }), signal);
        if (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255) throw new Error("Invalid exit code");
        exitCode = result.exitCode; commands++; return result.exitCode;
      } finally {
        stdout.end(); stderr.end();
        receipt.commands.push({ commandId, argvSha256: hash(JSON.stringify(["node", ...args])), startedAt, finishedAt: new Date().toISOString(), exitCode,
          stdoutBytes, stderrBytes, stdoutSha256: stdoutHash.digest("hex"), stderrSha256: stderrHash.digest("hex") });
      }
    };
    // Fixed commands only, with pinned runtime and digest checks before/after.
    if (await run("runtime", ["-e", `if(process.version!==${JSON.stringify(config.nodeVersion)})process.exit(43)`]) !== 0) throw new Error("Runtime mismatch");
    if (await run("hash_before", ["-e", remoteDigestCheck]) !== 0) throw new Error("Fixture integrity failed");
    if (await run("issue", ["--test", "tests/issue.mjs"]) !== 1) throw new Error("Unexpected baseline exit");
    if (await run("regressions", ["--test", "tests/regression.mjs"]) !== 0) throw new Error("Unexpected regression exit");
    if (await run("hash_after", ["-e", remoteDigestCheck]) !== 0) throw new Error("Fixture integrity failed");
    status = "SMOKE_FINISHED";
  } catch {
    status = cancellation?.aborted ? "CANCELLED" : deadline.aborted ? "TIMED_OUT" : "SMOKE_FAILED";
  } finally {
    if (sandbox) await cleanup(sandbox);
    try { await control.finish(cleanupConfirmed); } catch { cleanupConfirmed = false; }
    receipt.finishedAt = new Date().toISOString();
  }
  // A smoke checks transport/exit codes only. It never produces a verdict or
  // inserts a Run/report/evidence. An assertion proof requires separate RPF-004.
  return { status: cleanupConfirmed ? status : "CLEANUP_UNCONFIRMED", cleanupConfirmed, commands, receipt: smokeReceiptSchema.parse(receipt) };
}
