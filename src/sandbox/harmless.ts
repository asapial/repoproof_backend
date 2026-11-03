import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

// This is an operator smoke, never an issue runner or isolation/verdict proof.
export const harmlessScripts = Object.freeze({
  identity: 'console.log(JSON.stringify({marker:"RPF_HARMLESS_V1",node:process.version,platform:process.platform,arch:process.arch}))',
  deadline: 'setTimeout(()=>process.exit(0),10000)',
  cancellation: 'setInterval(()=>{},1000)',
});
export const harmlessLimits = Object.freeze({ image: "vercel/sandbox/node@sha256:dd20407070335f1605d474df72a4fc6a42d663526d1f915387a06cdbf167c0eb", lifetimeMs: 45000, operationMs: 30000, cleanupMs: 8000, outputBytes: 2048 });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const configSchema = z.object({ name: z.string().regex(/^rpf-harmless-[a-z0-9-]{8,60}$/), teamId: z.string().regex(/^team_[A-Za-z0-9_-]{1,100}$/), projectId: z.string().regex(/^prj_[A-Za-z0-9_-]{1,100}$/), token: z.string().min(16).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/) }).strict();
export type HarmlessConfig = z.infer<typeof configSchema>;
type Kind = keyof typeof harmlessScripts;
type ObservedCommand = { commandId: string; exitCode: number | null; durationMs: number | undefined };
export type HarmlessInstance = {
  observe(): unknown;
  run(kind: "identity" | "deadline", stdout: Writable, stderr: Writable, signal: AbortSignal): Promise<ObservedCommand>;
  cancel(signal: AbortSignal): Promise<ObservedCommand>;
  stop(signal: AbortSignal): Promise<{ sessionId: string; status: string; snapshotCreated: boolean }>;
};
export type HarmlessProvider = { create(options: Parameters<typeof Sandbox.create>[0]): Promise<HarmlessInstance> };
export type HarmlessControl = {
  // Trusted foreground operator only: durable one-shot claim precedes create.
  // No HTTP/model caller may supply this authority or a positive boolean.
  claim(policySha256: string): Promise<boolean>;
  record(event: { stage: "CLAIMED" | "CREATED" | "IDENTITY" | "DEADLINE" | "CANCELLATION" | "CLEANUP"; policySha256: string }): Promise<void>;
};
const observationSchema = z.object({ name: z.string().min(1).max(128), sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), image: z.literal(harmlessLimits.image), networkPolicy: z.literal("deny-all"), persistent: z.literal(false), vcpus: z.literal(1), memoryMb: z.literal(2048), timeoutMs: z.literal(harmlessLimits.lifetimeMs), mountCount: z.literal(0), currentSnapshot: z.null() }).strict();
const identitySchema = z.object({ marker: z.literal("RPF_HARMLESS_V1"), node: z.string().regex(/^v24\.\d+\.\d+$/), platform: z.literal("linux"), arch: z.enum(["x64", "arm64"]) }).strict();
export type HarmlessReceipt = {
  kind: "RPF_HARMLESS_SANDBOX_SMOKE_V1"; status: "UNAVAILABLE" | "FAILED" | "COMPLETE" | "CLEANUP_UNKNOWN";
  authenticity: "SDK_OBSERVATION_NOT_ISOLATION_PROOF"; rpf004Complete: false; fixtureExecutions: 0;
  policySha256: string; requestedImage: string; observation: z.infer<typeof observationSchema> | null;
  identity: z.infer<typeof identitySchema> | null; commands: Array<{ kind: Kind; argvSha256: string; commandId: string; exitCode: number; durationMs: number; stdoutBytes: number; stderrBytes: number; stdoutSha256: string; stderrSha256: string }>;
  cleanup: { attempted: boolean; confirmed: boolean; snapshotCreated: boolean | null };
  transport: { createInvocations: number; mutationInvocations: number; responseStatuses: number[] };
};

/** Refuse uncertain mutation retries before a second HTTP effect is sent. */
export function harmlessEffectFetch(transport: typeof fetch = globalThis.fetch, observation?: HarmlessReceipt["transport"]): typeof fetch {
  const sent = new Set<string>();
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    // SDK 3.9.1 uses vercel.com/api; direct metadata reads use api.vercel.com.
    // Canonicalize only those two fixed prefixes, including the create key.
    const path = url.origin === "https://api.vercel.com" ? url.pathname : url.origin === "https://vercel.com" && url.pathname.startsWith("/api/") ? url.pathname.slice(4) : "";
    if (url.username || url.password || url.hash || !/^\/v[23]\/sandboxes(?:\/|$)/.test(path)) throw new Error("Harmless transport denied");
    if (method !== "GET") {
      if (method !== "POST") throw new Error("Harmless transport denied");
      const body = init?.body ?? (input instanceof Request ? await input.clone().text() : "");
      if (typeof body !== "string" || Buffer.byteLength(body) > 16384) throw new Error("Harmless transport denied");
      const key = /^\/v[23]\/sandboxes$/.test(path) ? "CREATE" : `${method}:${path}:${url.search}:${hash(body)}`;
      if (sent.has(key)) return new Response('{"error":{"message":"Uncertain effect retry denied"}}', { status: 409 });
      sent.add(key);
      if (observation) { observation.mutationInvocations++; if (key === "CREATE") observation.createInvocations++; }
    }
    const response = await transport(input, { ...init, redirect: "error" });
    if (observation && observation.responseStatuses.length < 64) observation.responseStatuses.push(response.status);
    return response;
  };
}

export const harmlessSdkProvider: HarmlessProvider = { create: async options => {
  const sandbox = await Sandbox.create(options);
  // Keep a stop handle even if reading/pinning session metadata fails.
  let session: ReturnType<typeof sandbox.currentSession> | undefined;
  const pin = () => session ??= sandbox.currentSession();
  const commandObservation = async (command: { cmdId: string; exitCode: number | null }, signal: AbortSignal) => {
    const observed = await pin().getCommand(command.cmdId, { signal });
    // SDK 3.9.1's streaming completion uses exitCode ?? 0. Independently read
    // the command: missing raw exit state must never become observed success.
    if (observed.cmdId !== command.cmdId || observed.exitCode !== command.exitCode) throw new Error("Command completion unconfirmed");
    return { commandId: observed.cmdId, exitCode: observed.exitCode, durationMs: observed.durationMs };
  };
  return {
    observe: () => ({ name: sandbox.name, sessionId: pin().sessionId, image: sandbox.image, networkPolicy: pin().networkPolicy, persistent: sandbox.persistent, vcpus: pin().vcpus, memoryMb: pin().memory, timeoutMs: pin().timeout, mountCount: Object.keys(sandbox.mounts ?? {}).length, currentSnapshot: sandbox.currentSnapshotId ?? null }),
    run: async (kind, stdout, stderr, signal) => {
      const command = await pin().runCommand({ cmd: "node", args: ["-e", harmlessScripts[kind]], env: {}, sudo: false, timeoutMs: kind === "deadline" ? 500 : 5000, stdout, stderr, signal });
      return commandObservation(command, signal);
    },
    cancel: async signal => {
      const command = await pin().runCommand({ cmd: "node", args: ["-e", harmlessScripts.cancellation], env: {}, sudo: false, detached: true, timeoutMs: 10000, signal });
      await command.kill("SIGKILL", { abortSignal: signal });
      const finished = await command.wait({ signal }); return commandObservation(finished, signal);
    },
    stop: async signal => {
      if (session) { const result = await session.stop({ signal }); return { sessionId: result.session.id, status: result.session.status, snapshotCreated: Boolean(result.snapshot) }; }
      const result = await sandbox.stop({ signal }); return { sessionId: result.id, status: result.status, snapshotCreated: Boolean(result.snapshot) };
    },
  };
} };

function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  void operation.catch(() => {});
  if (signal.aborted) return Promise.reject(new Error("Harmless operation aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Harmless operation aborted")); signal.addEventListener("abort", abort, { once: true });
    operation.then(value => { signal.removeEventListener("abort", abort); if (signal.aborted) abort(); else resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

export async function executeHarmlessSmoke(input: HarmlessConfig, control: HarmlessControl, provider: HarmlessProvider = harmlessSdkProvider, cancellation?: AbortSignal): Promise<HarmlessReceipt> {
  const config = configSchema.parse(input);
  const policy = { name: config.name, teamId: config.teamId, projectId: config.projectId, image: harmlessLimits.image, resources: { vcpus: 1 }, timeout: harmlessLimits.lifetimeMs, persistent: false, networkPolicy: "deny-all" as const, ports: [] as number[], env: {}, mounts: {} };
  for (const value of [policy.resources, policy.ports, policy.env, policy.mounts, policy]) Object.freeze(value);
  const policySha256 = hash(JSON.stringify(policy));
  const receipt: HarmlessReceipt = { kind: "RPF_HARMLESS_SANDBOX_SMOKE_V1", status: "UNAVAILABLE", authenticity: "SDK_OBSERVATION_NOT_ISOLATION_PROOF", rpf004Complete: false, fixtureExecutions: 0, policySha256, requestedImage: harmlessLimits.image, observation: null, identity: null, commands: [], cleanup: { attempted: false, confirmed: false, snapshotCreated: null }, transport: { createInvocations: 0, mutationInvocations: 0, responseStatuses: [] } };
  if (cancellation?.aborted || process.env.DEBUG_FETCH === "true") return receipt;
  const admission = AbortSignal.any([AbortSignal.timeout(5000), ...(cancellation ? [cancellation] : [])]);
  try { if (await bounded(control.claim(policySha256), admission) !== true) return receipt; await bounded(control.record({ stage: "CLAIMED", policySha256 }), admission); }
  catch { return receipt; }
  const deadline = AbortSignal.timeout(harmlessLimits.operationMs), outputAbort = new AbortController();
  const signal = AbortSignal.any([deadline, outputAbort.signal, ...(cancellation ? [cancellation] : [])]);
  let instance: HarmlessInstance | undefined, cleanupWork: Promise<void> | undefined, totalOutput = 0;
  const clean = (target: HarmlessInstance) => cleanupWork ??= (async () => {
    receipt.cleanup.attempted = true; const cleanupSignal = AbortSignal.timeout(harmlessLimits.cleanupMs);
    try {
      // A fresh signal keeps cleanup alive after cancellation or the main deadline.
      const stopped = await bounded(target.stop(cleanupSignal), cleanupSignal); receipt.cleanup.snapshotCreated = stopped.snapshotCreated;
      receipt.cleanup.confirmed = receipt.observation !== null && stopped.sessionId === receipt.observation.sessionId && stopped.status === "stopped" && stopped.snapshotCreated === false;
      await bounded(control.record({ stage: "CLEANUP", policySha256 }), cleanupSignal);
    } catch { receipt.cleanup.confirmed = false; }
  })();
  try {
    receipt.status = "FAILED";
    const options = Object.freeze({ ...policy, token: config.token, fetch: harmlessEffectFetch(globalThis.fetch, receipt.transport), signal });
    const creation = provider.create(options);
    void creation.then(value => { if (signal.aborted) return clean(value); }).catch(() => {});
    instance = await bounded(creation, signal);
    const observation = observationSchema.parse(instance.observe());
    if (observation.name !== config.name) throw new Error("Sandbox identity mismatch");
    receipt.observation = observation;
    await bounded(control.record({ stage: "CREATED", policySha256 }), signal);
    const run = async (kind: Kind) => {
      let out: Buffer = Buffer.alloc(0), err: Buffer = Buffer.alloc(0);
      const sink = (error: boolean) => new Writable({ write(chunk: Buffer, _encoding, done) {
        totalOutput += chunk.length;
        if (totalOutput > harmlessLimits.outputBytes) outputAbort.abort();
        else if (error) err = Buffer.concat([err, chunk]); else out = Buffer.concat([out, chunk]); done();
      } }).on("error", () => outputAbort.abort());
      const stdout = sink(false), stderr = sink(true);
      try {
        const result = await bounded(kind === "cancellation" ? instance!.cancel(signal) : instance!.run(kind, stdout, stderr, signal), signal);
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(result.commandId) || !Number.isInteger(result.exitCode) || result.exitCode === null || result.exitCode < 0 || result.exitCode > 255 || result.durationMs === undefined || !Number.isFinite(result.durationMs) || result.durationMs < 0 || result.durationMs > harmlessLimits.operationMs) throw new Error("Command evidence missing");
        receipt.commands.push({ kind, argvSha256: hash(JSON.stringify(["node", "-e", harmlessScripts[kind]])), commandId: result.commandId, exitCode: result.exitCode, durationMs: result.durationMs, stdoutBytes: out.length, stderrBytes: err.length, stdoutSha256: hash(out), stderrSha256: hash(err) });
        if (err.length || (kind === "identity" ? result.exitCode !== 0 : result.exitCode !== 137) || (kind !== "identity" && (result.durationMs === 0 || result.durationMs >= 5000))) throw new Error("Command check failed");
        if (kind === "identity") receipt.identity = identitySchema.parse(JSON.parse(out.toString("utf8")));
        else if (out.length) throw new Error("Unexpected command output");
        await bounded(control.record({ stage: kind === "identity" ? "IDENTITY" : kind === "deadline" ? "DEADLINE" : "CANCELLATION", policySha256 }), signal);
      } finally { stdout.end(); stderr.end(); }
    };
    await run("identity"); await run("deadline"); await run("cancellation"); receipt.status = "COMPLETE";
  } catch { receipt.status = "FAILED"; }
  finally { if (instance) await clean(instance); else receipt.status = "CLEANUP_UNKNOWN"; }
  if (!receipt.cleanup.confirmed) receipt.status = "CLEANUP_UNKNOWN";
  return receipt;
}
