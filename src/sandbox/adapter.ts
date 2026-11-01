import { Writable } from "node:stream";
import { Sandbox } from "@vercel/sandbox";
import { fixtureDigests, validateFixture, type FixtureFile } from "./fixture";
import { smokeLimits, type SmokeConfig } from "./policy";
import type { SmokeControl } from "./control";

type CreateOptions = Parameters<typeof Sandbox.create>[0];
export type CommandOptions = { cmd: string; args: string[]; cwd: string; env: Record<string, string>; sudo: false; timeoutMs: number; signal: AbortSignal; stdout: Writable; stderr: Writable };
export interface SmokeSandbox {
  persistent: boolean;
  writeFiles(files: FixtureFile[], opts: { signal: AbortSignal }): Promise<unknown>;
  runCommand(options: CommandOptions): Promise<{ exitCode: number }>;
  stop(opts: { signal: AbortSignal }): Promise<{ status: string }>;
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
export const vercelSmokeProvider: SmokeProvider = { create: options => Sandbox.create({ ...options, fetch: oneCreateFetch() }) };
export type SmokeStatus = "SMOKE_FINISHED" | "SMOKE_FAILED" | "CANCELLED" | "TIMED_OUT" | "CLEANUP_UNCONFIRMED" | "UNAVAILABLE";
export type SmokeResult = { status: SmokeStatus; cleanupConfirmed: boolean; commands: number };
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
      const cleanupSignal = AbortSignal.timeout(smokeLimits.cleanupMs);
      try {
        const stopped = await bounded(instance.stop({ signal: cleanupSignal }), cleanupSignal);
        cleanupConfirmed = stopped.status === "stopped";
      } catch { cleanupConfirmed = false; }
    })();
    return stopPromise;
  };
  let outputBytes = 0;
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) {
    outputBytes += chunk.length;
    if (outputBytes > smokeLimits.outputBytes) controller.abort();
    // Discard all raw output. No token, file contents or provider error in logs.
    done();
  } });
  try {
    const creation = provider.create({ token: config.token, projectId: config.projectId, teamId: config.teamId,
      image: config.image, resources: { vcpus: smokeLimits.vcpus }, timeout: smokeLimits.lifetimeMs,
      persistent: false, networkPolicy: "deny-all", ports: [], env: {}, signal });
    // If cancellation wins creation, clean a late result too. Permission stays
    // consumed even if provider ignores cancellation or the host is terminated.
    void creation.then(instance => { if (signal.aborted) return cleanup(instance); }).catch(() => {});
    sandbox = await bounded(creation, signal);
    if (sandbox.persistent !== false) throw new Error("Sandbox policy mismatch");
    await bounded(sandbox.writeFiles(upload, { signal }), signal);
    const run = async (args: string[]) => {
      const result = await bounded(sandbox!.runCommand({ cmd: "node", args, cwd: "/vercel/sandbox", env: {}, sudo: false,
        timeoutMs: 5_000, stdout: sink, stderr: sink, signal }), signal);
      commands++;
      return result.exitCode;
    };
    // Fixed commands only, with pinned runtime and digest checks before/after.
    if (await run(["-e", `if(process.version!==${JSON.stringify(config.nodeVersion)})process.exit(43)`]) !== 0) throw new Error("Runtime mismatch");
    if (await run(["-e", remoteDigestCheck]) !== 0) throw new Error("Fixture integrity failed");
    if (await run(["--test", "tests/issue.mjs"]) !== 1) throw new Error("Unexpected baseline exit");
    if (await run(["--test", "tests/regression.mjs"]) !== 0) throw new Error("Unexpected regression exit");
    if (await run(["-e", remoteDigestCheck]) !== 0) throw new Error("Fixture integrity failed");
    status = "SMOKE_FINISHED";
  } catch {
    status = cancellation?.aborted ? "CANCELLED" : deadline.aborted ? "TIMED_OUT" : "SMOKE_FAILED";
  } finally {
    if (sandbox) await cleanup(sandbox);
    try { await control.finish(cleanupConfirmed); } catch { cleanupConfirmed = false; }
    sink.end();
  }
  // A smoke checks transport/exit codes only. It never produces a verdict or
  // inserts a Run/report/evidence. An assertion proof requires separate RPF-004.
  return { status: cleanupConfirmed ? status : "CLEANUP_UNCONFIRMED", cleanupConfirmed, commands };
}
