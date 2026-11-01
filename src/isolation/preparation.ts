import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isolationBundleSha256, loadIsolationBundle } from "./bundle";

export const isolationProbeModes = ["network", "environment", "resources", "cross_write", "cross_read", "timeout", "failure"] as const;
export const isolationProbeLimits = Object.freeze({ vcpus: 1, memoryMb: 2048, lifetimeMs: 30000, commandTimeoutMs: 5000, maxOutputBytes: 16384, concurrency: 1 });
const modeSchema = z.enum(isolationProbeModes);
const optionsSchema = z.object({ publicV4: z.ipv4().optional(), publicV6: z.ipv6().nullable().optional() }).strict();
export async function prepareIsolationProbe(mode: typeof isolationProbeModes[number], options: z.infer<typeof optionsSchema> = {}) {
  modeSchema.parse(mode); const validated = optionsSchema.parse(options);
  if (mode === "network" && !validated.publicV4) throw new Error("Approved owned canary required");
  const nonce = randomUUID();
  const input = { nonce, mode, ...(mode === "network" ? { publicV4: validated.publicV4, publicV6: validated.publicV6 ?? null } : {}),
    ...(mode === "environment" ? { hostCanaryPath: `/tmp/repoproof-controller-${nonce}` } : {}),
    ...(mode === "cross_write" ? { canary: randomUUID() } : {}) };
  const file = mode === "timeout" ? "hold.mjs" : mode === "failure" ? "fail.mjs" : "probe.mjs";
  const args = [`/vercel/sandbox/isolation/${file}`];
  const files = await loadIsolationBundle();
  const content = Buffer.from(JSON.stringify(input), "utf8");
  return { trust: "PREPARATION_ONLY" as const, nonce, fixtureBundleSha256: isolationBundleSha256,
    command: { cmd: "node" as const, args, cwd: "/vercel/sandbox", sudo: false as const, env: {}, timeoutMs: mode === "timeout" ? 1000 : isolationProbeLimits.commandTimeoutMs },
    commandSha256: createHash("sha256").update(JSON.stringify(["node", ...args])).digest("hex"),
    inputSha256: createHash("sha256").update(content).digest("hex"),
    files: [...files.map(file => ({ path: `/vercel/sandbox/isolation/${file.path}`, content: file.content })), { path: "/vercel/sandbox/probe-input.json", content }] };
}

// A timeout/refused connection alone cannot establish firewall enforcement.
export function classifyConnection(value: { connected: boolean; code: string }): "FAIL" | "DENIAL_OBSERVED" | "UNKNOWN" {
  if (value.connected) return "FAIL";
  return ["EACCES", "EPERM"].includes(value.code) ? "DENIAL_OBSERVED" : "UNKNOWN";
}
