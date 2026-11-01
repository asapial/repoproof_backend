import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { expect, it, vi } from "vitest";
import ts from "typescript";
import { assessIsolation, isolationGates, isolationSigningBytes, type IsolationObservation, type IsolationTrustKey } from "./assessment";
import { isolationBundleSha256, isolationFiles, loadIsolationBundle } from "./bundle";
import { classifyConnection, prepareIsolationProbe } from "./preparation";

// Cryptographic test fixtures only. They are not registered deployment identities
// and never represent a live provider observation or real RPF-004 acceptance.
function fixture() {
  const now = Date.now(); const auditId = randomUUID();
  const pairs = [generateKeyPairSync("ed25519"),generateKeyPairSync("ed25519")];
  const keys: IsolationTrustKey[] = pairs.map((pair,index) => ({ role: index ? "observer" : "controller", keyId: `test-${index}`, publicKeyPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString(), liveIdentityApproved: true }));
  const observations: IsolationObservation[] = pairs.map((_pair,index) => ({ evidenceId: randomUUID(), auditId, nonce: randomBytes(32).toString("hex"), role: index ? "observer" : "controller", keyId: `test-${index}`, source: "LIVE_PROVIDER", issuedAtMs: now, expiresAtMs: now+60000, fixtureBundleSha256: isolationBundleSha256, imageDigest: "a".repeat(64), sessionIds: ["test-session-a","test-session-b"], gates: isolationGates.map(id => ({ id, outcome: "PASS", factsSha256: "b".repeat(64) })), cleanupConfirmed: true, signature: "0".repeat(128) }));
  const seal = () => observations.forEach((observation,index) => { observation.signature = sign(null,isolationSigningBytes(observation),pairs[index]!.privateKey).toString("hex"); }); seal();
  const replay = { consume: vi.fn(async () => true) };
  const expected = { auditId, fixtureBundleSha256: isolationBundleSha256, imageDigest: "a".repeat(64), sessionIds: ["test-session-a","test-session-b"], twoSandboxApproved: true };
  return { observations, keys, replay, expected, now, seal,
    run: () => assessIsolation(Buffer.from(JSON.stringify(observations)),keys,replay,expected,now) };
}
it("loads and syntax-parses pinned owned fixtures without importing or executing them", async () => {
  const files = await loadIsolationBundle(); expect(files).toHaveLength(3);
  for (const file of files) {
    expect(createHash("sha256").update(file.content).digest("hex")).toBe(isolationFiles[`fixtures/isolation-owned/${file.path}` as keyof typeof isolationFiles]);
    const parsed = ts.transpileModule(file.content.toString("utf8"),{ fileName: file.path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, allowJs: true } });
    expect(parsed.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
  }
  expect(createHash("sha256").update(JSON.stringify(Object.entries(isolationFiles))).digest("hex")).toBe(isolationBundleSha256);
});
it("prepares only fixed remote commands/files with no host execution, env or caller commands", async () => {
  const packet = await prepareIsolationProbe("network",{ publicV4: "203.0.113.10", publicV6: null });
  expect(packet.trust).toBe("PREPARATION_ONLY"); expect(packet.command).toMatchObject({ cmd: "node", args: ["/vercel/sandbox/isolation/probe.mjs"], env: {}, sudo: false, timeoutMs: 5000 });
  expect(packet.files).toHaveLength(4); expect(packet.files.every(file => file.path.startsWith("/vercel/sandbox/"))).toBe(true);
  await expect(prepareIsolationProbe("network")).rejects.toThrow();
  await expect(prepareIsolationProbe("network",{ publicV4: "invalid" })).rejects.toThrow();
  await expect(prepareIsolationProbe("resources",{ cmd: "arbitrary" } as never)).rejects.toThrow();
  expect((await prepareIsolationProbe("timeout")).command).toMatchObject({ args: ["/vercel/sandbox/isolation/hold.mjs"], timeoutMs: 1000 });
  expect((await prepareIsolationProbe("failure")).command.args).toEqual(["/vercel/sandbox/isolation/fail.mjs"]);
  const read = await prepareIsolationProbe("cross_read"); expect(read.files.at(-1)!.content.toString()).not.toContain("canary");
});
it("keeps refused, routing, unsupported and timeout network outcomes ambiguous", () => {
  expect(classifyConnection({ connected: true, code: "CONNECTED" })).toBe("FAIL");
  for (const code of ["TIMEOUT","ECONNREFUSED","ENETUNREACH","EAFNOSUPPORT","OTHER"]) expect(classifyConnection({ connected: false, code })).toBe("UNKNOWN");
  expect(classifyConnection({ connected: false, code: "EPERM" })).toBe("DENIAL_OBSERVED");
});
it("requires independent signed fresh complete statements and never marks RPF-004 complete", async () => {
  const f = fixture(); expect(await f.run()).toEqual({ status: "READY_FOR_INDEPENDENT_REVIEW", reasons: [], rpf004Complete: false }); expect(f.replay.consume).toHaveBeenCalledTimes(1);
});
it("does not waive concurrent cross-sandbox acceptance under initial concurrency one", async () => {
  const f = fixture(); f.expected.twoSandboxApproved = false; expect((await f.run()).status).toBe("INCOMPLETE");
  f.expected.twoSandboxApproved = true; f.expected.sessionIds = ["test-session-a"]; f.observations.forEach(item => { item.sessionIds = ["test-session-a"]; }); f.seal(); expect((await f.run()).status).toBe("INCOMPLETE");
});
it("rejects synthetic sources or unapproved identities even with valid signatures", async () => {
  const f = fixture(); f.observations[0]!.source = "OFFLINE_SYNTHETIC"; f.seal(); expect((await f.run()).status).toBe("INCOMPLETE");
  f.observations[0]!.source = "LIVE_PROVIDER"; f.keys[0]!.liveIdentityApproved = false; f.seal(); expect((await f.run()).status).toBe("INCOMPLETE"); expect(f.replay.consume).not.toHaveBeenCalled();
});
it("rejects missing, duplicated, unknown and untested mandatory gates", async () => {
  for (const mode of ["missing","duplicate","unknown"] as const) {
    const f = fixture();
    if (mode === "missing") f.observations[0]!.gates.pop();
    else if (mode === "duplicate") f.observations[0]!.gates[0] = { ...f.observations[0]!.gates[1]! };
    else f.observations[0]!.gates[0]!.outcome = "UNKNOWN";
    f.seal(); expect((await f.run()).status).toBe("INCOMPLETE");
  }
});
it("surfaces authenticated isolation failure without a product verdict", async () => {
  const f = fixture(); f.observations.forEach(item => { item.gates[0]!.outcome = "FAIL"; }); f.seal();
  expect(await f.run()).toEqual({ status: "FAILED", reasons: ["EXTERNAL_V4"], rpf004Complete: false });
});
it("rejects unconfirmed cleanup or differing independently endorsed facts", async () => {
  const f = fixture(); f.observations[0]!.cleanupConfirmed = false; f.seal(); expect((await f.run()).status).toBe("INCOMPLETE");
  f.observations[0]!.cleanupConfirmed = true; f.observations[0]!.gates[0]!.factsSha256 = "c".repeat(64); f.seal(); expect((await f.run()).status).toBe("INCOMPLETE");
});
it("rejects altered signatures, wrong fixture/image/session scope and expired/future statements", async () => {
  for (const change of ["signature","fixture","image","session","expired","future"] as const) {
    const f = fixture(); const observation = f.observations[0]!;
    if (change === "signature") observation.signature = "0".repeat(128);
    if (change === "fixture") observation.fixtureBundleSha256 = "c".repeat(64);
    if (change === "image") observation.imageDigest = "c".repeat(64);
    if (change === "session") observation.sessionIds = ["different-session"];
    if (change === "expired") observation.expiresAtMs = f.now;
    if (change === "future") observation.issuedAtMs = f.now+1;
    if (change !== "signature") f.seal(); expect((await f.run()).status).toBe("INCOMPLETE");
  }
});
it("requires separate keys and identities, not two signatures from one signer", async () => {
  const f = fixture(); f.keys[1]!.publicKeyPem = f.keys[0]!.publicKeyPem; expect((await f.run()).status).toBe("INCOMPLETE");
  const duplicate = fixture(); duplicate.observations[1]!.role = "controller"; duplicate.seal(); expect((await duplicate.run()).status).toBe("INCOMPLETE");
});
it("fails closed on absent, rejected, conflicting or unavailable durable replay storage", async () => {
  const f = fixture(); f.replay.consume.mockResolvedValue(false); expect((await f.run()).status).toBe("INCOMPLETE");
  f.replay.consume.mockRejectedValue(new Error("private database credential")); expect(JSON.stringify(await f.run())).not.toContain("private database");
  expect((await assessIsolation(Buffer.from(JSON.stringify(f.observations)),f.keys,null,f.expected,f.now)).status).toBe("INCOMPLETE");
});
it("bounds raw input and rejects malformed UTF-8/JSON and model verdict fields", async () => {
  const f = fixture();
  for (const bytes of [Buffer.alloc(65537),Buffer.from([0xff]),Buffer.from("{"),Buffer.from(JSON.stringify({ verdict: "VERIFIED" }))]) expect((await assessIsolation(bytes,f.keys,f.replay,f.expected,f.now)).status).toBe("INCOMPLETE");
  expect(f.replay.consume).not.toHaveBeenCalled();
});
