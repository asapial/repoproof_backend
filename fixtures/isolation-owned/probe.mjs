// Owned, non-destructive probe. Execute only in an explicitly approved disposable
// cloud sandbox. Host tooling may read/hash/parse this file, never import/run it.
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { createHash } from "node:crypto";

const input = JSON.parse(await fs.readFile("/vercel/sandbox/probe-input.json", "utf8"));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
if (!uuid.test(input.nonce) || !["network", "environment", "resources", "cross_write", "cross_read"].includes(input.mode)) throw new Error("Invalid owned probe input");
const result = { version: "owned-isolation-v1", nonce: input.nonce, mode: input.mode, facts: {} };
const exists = async path => { try { await fs.lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw new Error("Owned path check unavailable"); } };
const connect = (host, port = 443) => new Promise(resolve => {
  const socket = net.createConnection({ host, port }); let done = false;
  const finish = (connected, code) => { if (done) return; done = true; socket.destroy(); resolve({ connected, code }); };
  socket.setTimeout(1000, () => finish(false, "TIMEOUT"));
  socket.once("connect", () => finish(true, "CONNECTED"));
  socket.once("error", error => finish(false, ["EACCES","EPERM","ENETUNREACH","EHOSTUNREACH","ECONNREFUSED","EAFNOSUPPORT","EINVAL"].includes(error.code) ? error.code : "OTHER"));
});
if (input.mode === "network") {
  // Canary IPs must be operator-owned, independently checked and approved.
  if (net.isIP(input.publicV4) !== 4 || (input.publicV6 !== null && net.isIP(input.publicV6) !== 6)) throw new Error("Approved canary addresses required");
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    result.facts.loopbackControl = await connect("127.0.0.1", server.address().port);
    const targets = { external_v4: input.publicV4, private_10: "10.0.0.1", private_172: "172.16.0.1", private_192: "192.168.0.1",
      metadata_aws: "169.254.169.254", metadata_container: "169.254.170.2", metadata_cgnat: "100.100.100.200",
      private_v6: "fd00::1", mapped_metadata_v6: "::ffff:169.254.169.254", ...(input.publicV6 ? { external_v6: input.publicV6 } : {}) };
    result.facts.targets = Object.fromEntries(await Promise.all(Object.entries(targets).map(async ([id, host]) => [id, await connect(host, id.startsWith("external_") ? 443 : 80)])));
  } finally { await new Promise(resolve => server.close(resolve)); }
} else if (input.mode === "environment") {
  if (input.hostCanaryPath !== `/tmp/repoproof-controller-${input.nonce}`) throw new Error("Owned controller canary path required");
  const names = ["MODEL_API_KEY","OpenRouter_API_KEY","DATABASE_URL","DIRECT_URL","BETTER_AUTH_SECRET","SANDBOX_TOKEN","SANDBOX_CONTROL_DATABASE_URL","VERCEL_OIDC_TOKEN","VERCEL_AUTOMATION_BYPASS_SECRET","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","EMAIL_SENDER_SMTP_PASS","GOOGLE_CLIENT_SECRET","CLOUDINARY_API_SECRET","ACCESS_TOKEN_SECRET","REFRESH_TOKEN_SECRET"];
  result.facts.presentSecretNames = names.filter(name => Object.hasOwn(process.env, name));
  result.facts.hostCanaryVisible = await exists(input.hostCanaryPath);
  result.facts.dockerSocketVisible = await exists("/var/run/docker.sock");
  result.facts.uid = process.getuid?.() ?? null;
} else if (input.mode === "resources") {
  const memory = await fs.readFile("/proc/meminfo", "utf8");
  result.facts.availableCpus = os.availableParallelism();
  result.facts.totalMemoryKiB = Number(/^MemTotal:\s+(\d+)\s+kB$/m.exec(memory)?.[1] ?? 0);
} else if (input.mode === "cross_write") {
  if (typeof input.canary !== "string" || !uuid.test(input.canary)) throw new Error("Owned synthetic canary required");
  await fs.writeFile("/tmp/repoproof-isolation-owned-canary", input.canary, { flag: "wx", mode: 0o600 });
  result.facts.canarySha256 = createHash("sha256").update(input.canary).digest("hex");
} else {
  // Reader never receives the writer's canary value, only this fixed path.
  result.facts.canaryVisible = await exists("/tmp/repoproof-isolation-owned-canary");
}
process.stdout.write(JSON.stringify(result) + "\n");
