// Foreground operator entry only. Never mounted by Express, Vercel or a worker.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { open, readFile, lstat, type FileHandle } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { executeHarmlessSmoke, harmlessLimits, type HarmlessReceipt, type HarmlessControl } from "../src/sandbox/harmless";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const environment = z.object({
  RPF_HARMLESS_APPROVAL: z.literal("OWNED_HOBBY_ONE_HARMLESS_VM"),
  RPF_HARMLESS_EVIDENCE_DIR: z.string().min(1),
  RPF_HARMLESS_QUOTA_FILE: z.string().regex(/^provider-[a-z0-9-]+\.json$/),
  RPF_HARMLESS_QUOTA_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
  RPF_HARMLESS_INVENTORY_FILE: z.string().regex(/^provider-[a-z0-9-]+\.json$/),
  RPF_HARMLESS_INVENTORY_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
  RPF_HARMLESS_LINKED_PROJECT_FILE: z.string().min(1),
  RPF_HARMLESS_REVIEWED_LOCAL_DENIAL_SHA256: z.literal("003d5890d3ac05a972056eadeaa7bbfeb83b17dd48a354aea34ebfe3b1ee8b75").optional(),
  RPF_HARMLESS_REVIEWED_STOPPED_ATTEMPT_SHA256: z.literal("849c03e35da94a7987b7acf6d315bf48033c854086018493e06c234b4c15e4f0").optional(),
  APPDATA: z.string().min(1),
}).refine(value => !(value.RPF_HARMLESS_REVIEWED_LOCAL_DENIAL_SHA256 && value.RPF_HARMLESS_REVIEWED_STOPPED_ATTEMPT_SHA256));
const quotaSchema = z.object({ observedAtUtc: z.iso.datetime(), vercel: z.object({ planDisplayed: z.literal("Hobby"), teamSlug: z.literal("md-abu-syeed-abdullahs-projects"),
  sandboxCreations: z.object({ used: z.number().int().nonnegative(), included: z.literal(5000) }), activeCpu: z.object({ usedSeconds: z.number().nonnegative(), includedHours: z.literal(5) }),
  memory: z.object({ usedGbHours: z.number().nonnegative(), includedGbHours: z.literal(420) }), dataTransfer: z.object({ usedBytes: z.number().int().nonnegative(), includedGb: z.literal(20) }),
  snapshotStorage: z.object({ usedBytes: z.number().int().nonnegative(), includedGb: z.literal(15) }) }) });
const inventorySchema = z.object({ observedAtUtc: z.iso.datetime(), scope: z.literal("ALL_HOBBY_TEAM_PROJECTS_NO_DATE_FILTER"), status: z.literal("INVENTORY_COMPLETE"), teamFingerprint: z.string().regex(/^[a-f0-9]{16}$/), hobbyPlanVerifiedByApi: z.literal(true), linkedProjectIncluded: z.literal(true), allActiveInventoryVerifiedEmpty: z.literal(true), sandboxRecordCount: z.number().int().min(0).max(1), activeSandboxCount: z.literal(0), reviewedStoppedRecordCount: z.number().int().min(0).max(1), unknownSandboxRecordCount: z.literal(0), cloudWrites: z.literal(0) });
const linkedSchema = z.object({ projectId: z.string().regex(/^prj_[A-Za-z0-9_-]{1,100}$/), orgId: z.string().regex(/^team_[A-Za-z0-9_-]{1,100}$/) });
type CliConfig = { getGlobalPathConfig(): string };
type CliReader = { readCliAuthConfig(directory: string, options: { credStorage: "auto" }): unknown };

async function main() {
  if (process.env.RPF_HARMLESS_APPROVAL === undefined) { console.log(JSON.stringify({ status: "DISABLED", sandboxCreations: 0 })); return; }
  const env = environment.parse(process.env); assert.equal(process.versions.node.split(".")[0], "24"); assert.notEqual(process.env.DEBUG_FETCH, "true");
  assert.ok(isAbsolute(env.RPF_HARMLESS_EVIDENCE_DIR) && isAbsolute(env.RPF_HARMLESS_LINKED_PROJECT_FILE));
  const root = resolve(env.RPF_HARMLESS_EVIDENCE_DIR), evidence = join(root, "evidence");
  for (const directory of [root, evidence]) { const info = await lstat(directory); assert.ok(info.isDirectory() && !info.isSymbolicLink()); }
  const proof = async (name: string, expectedHash: string) => {
    const path = join(evidence, name), info = await lstat(path); assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 65536);
    const bytes = await readFile(path); assert.equal(digest(bytes), expectedHash); return JSON.parse(bytes.toString("utf8")) as unknown;
  };
  const quota = quotaSchema.parse(await proof(env.RPF_HARMLESS_QUOTA_FILE, env.RPF_HARMLESS_QUOTA_SHA256));
  const inventory = inventorySchema.parse(await proof(env.RPF_HARMLESS_INVENTORY_FILE, env.RPF_HARMLESS_INVENTORY_SHA256));
  let ledger = "rpf-harmless-first";
  let priorStopped: { name: string; sessionId: string } | undefined;
  if (env.RPF_HARMLESS_REVIEWED_STOPPED_ATTEMPT_SHA256) {
    // A distinct first-command milestone after the earlier VM was acknowledged
    // stopped and separately observed stopped. Its consumed claim stays intact.
    // No unknown effect, empty inventory or expiry grants another attempt.
    const oldClaim = z.object({ name: z.string().regex(/^rpf-harmless-[a-z0-9-]{8,60}$/), status: z.literal("CONSUMED_NEVER_AUTO_REARM") }).parse(await proof("rpf-harmless-sdk-origin-correction.claim.json", "c89e33f6f528249233f507d706e8ae9762af0b023c2671081a5ccc159bfdde29"));
    z.object({ receipt: z.object({ status: z.literal("CLEANUP_UNKNOWN"), observation: z.null(), commands: z.array(z.unknown()).length(0), cleanup: z.object({ attempted: z.literal(true), snapshotCreated: z.literal(false) }), transport: z.object({ createInvocations: z.literal(1), mutationInvocations: z.literal(2), responseStatuses: z.tuple([z.literal(200), z.literal(200)]) }) }) }).parse(await proof("rpf-harmless-sdk-origin-correction.receipt.json", "6b980f0942871a1a04d626b5f5a6e1331ff09e70c39d3365ac5abe1192b4d167"));
    const previous = z.object({ httpStatus: z.literal(200), observation: z.object({ name: z.literal(oldClaim.name), sessionId: z.string().min(1), status: z.literal("stopped"), persistent: z.literal(false), currentSnapshotId: z.null(), routeCount: z.literal(0), image: z.literal(harmlessLimits.image), vcpus: z.literal(1), memory: z.literal(2048), timeout: z.literal(45000), networkPolicy: z.literal("deny-all"), mountCount: z.literal(0) }), cloudWrites: z.literal(0), newCreates: z.literal(0), resume: z.literal(false) }).parse(await proof("provider-harmless-sdk-origin-correction-reconciliation.json", env.RPF_HARMLESS_REVIEWED_STOPPED_ATTEMPT_SHA256));
    priorStopped = { name: oldClaim.name, sessionId: previous.observation.sessionId };
    assert.equal(inventory.sandboxRecordCount, 1); assert.equal(inventory.reviewedStoppedRecordCount, 1);
    ledger = "rpf-harmless-pinned-image-correction";
  } else if (env.RPF_HARMLESS_REVIEWED_LOCAL_DENIAL_SHA256) {
    // One explicitly reviewed correction for this exact historical local deny.
    // Never rearm the old claim or generalize a 404/empty list into retry authority.
    z.object({ status: z.literal("ORIGINAL_SDK_CREATE_BLOCKED_BEFORE_TRANSPORT"), classification: z.literal("EXACT_BYTE_OFFLINE_REPLAY_AND_SOURCE_INFERENCE_NOT_HISTORICAL_PACKET_CAPTURE"), rawTransportCalls: z.literal(0), oldGuardSha256: z.literal("8844623b376d892b7cfd9a58a2a3f8d0fdb6ccab3402b39e05c0e9c1dcea112b"), installedApiClientSha256: z.literal("b1de5c164fe5360a34bfd51c653df63abd37c9cb4d53280d072c751d3cfd5da1"), priorReceiptSha256: z.literal("7e39f03239eae637787026d440dcb71cca02a5f4787235c05d12b960ca8eacbb") }).parse(await proof("harmless-sdk-origin-pre-dispatch-proof.json", env.RPF_HARMLESS_REVIEWED_LOCAL_DENIAL_SHA256));
    z.object({ receipt: z.object({ status: z.literal("CLEANUP_UNKNOWN"), observation: z.null(), commands: z.array(z.unknown()).length(0), cleanup: z.object({ attempted: z.literal(false), confirmed: z.literal(false) }) }) }).parse(await proof("rpf-harmless-first.receipt.json", "7e39f03239eae637787026d440dcb71cca02a5f4787235c05d12b960ca8eacbb"));
    z.object({ status: z.literal("CONSUMED_NEVER_AUTO_REARM") }).parse(await proof("rpf-harmless-first.claim.json", "bc0d03ea7bb58d15ab4565a330fb4c49cfff76150449c878aec753b443b9dfa7"));
    ledger = "rpf-harmless-sdk-origin-correction";
  }
  const fresh = (value: string, maximumMs: number) => { const age = Date.now() - Date.parse(value); assert.ok(age >= 0 && age <= maximumMs); };
  fresh(quota.observedAtUtc, 300000); fresh(inventory.observedAtUtc, 120000);
  // Leave more than one bounded attempt's resource allowance; Hobby itself
  // enforces no overage charges. This local estimate is not paid-plan authority.
  assert.ok(quota.vercel.sandboxCreations.used < 5000 && quota.vercel.activeCpu.usedSeconds < 17940 && quota.vercel.memory.usedGbHours < 419 && quota.vercel.dataTransfer.usedBytes < 19 * 1024 ** 3 && quota.vercel.snapshotStorage.usedBytes < 15 * 1024 ** 3);
  const linkedInfo = await lstat(env.RPF_HARMLESS_LINKED_PROJECT_FILE); assert.ok(linkedInfo.isFile() && !linkedInfo.isSymbolicLink());
  const linked = linkedSchema.parse(JSON.parse(await readFile(env.RPF_HARMLESS_LINKED_PROJECT_FILE, "utf8")));
  assert.equal(inventory.teamFingerprint, digest(linked.orgId).slice(0, 16));
  const cliRoot = join(env.APPDATA, "npm", "node_modules", "vercel"), cliPackage = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8")) as { name?: string; version?: string };
  assert.equal(cliPackage.name, "vercel"); assert.equal(cliPackage.version, "54.14.0");
  if (env.RPF_HARMLESS_REVIEWED_LOCAL_DENIAL_SHA256 || env.RPF_HARMLESS_REVIEWED_STOPPED_ATTEMPT_SHA256) assert.equal(digest(await readFile(join(process.cwd(), "node_modules", "@vercel", "sandbox", "dist", "api-client", "api-client.js"))), "b1de5c164fe5360a34bfd51c653df63abd37c9cb4d53280d072c751d3cfd5da1");
  const requireCli = createRequire(pathToFileURL(join(cliRoot, "dist", "vc.js")));
  const config = requireCli("@vercel/cli-config") as CliConfig, reader = requireCli("@vercel/cli-auth/credentials-store.js") as CliReader;
  // The official auto reader reads the existing keyring without migrating,
  // exporting, renewing, generating or persisting any credential.
  const auth = z.object({ token: z.string().min(16).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/) }).parse(reader.readCliAuthConfig(config.getGlobalPathConfig(), { credStorage: "auto" }));
  const providerGet = async (path: string, query: Record<string, string> = {}) => {
    assert.ok(["/v2/teams/" + linked.orgId, "/v9/projects/" + linked.projectId, "/v2/sandboxes"].includes(path) || /^\/v2\/sandboxes\/rpf-harmless-[a-z0-9-]+$/.test(path));
    const url = new URL(path, "https://api.vercel.com"); url.searchParams.set("teamId", linked.orgId); for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, { method: "GET", redirect: "error", headers: { authorization: `Bearer ${auth.token}`, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    assert.ok(response.ok && response.body); const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; assert.ok(bytes <= 262144); chunks.push(item.value); } } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };
  const teamEnvelope = z.object({ team: z.unknown().optional() }).passthrough().parse(await providerGet("/v2/teams/" + linked.orgId));
  const team = z.object({ id: z.literal(linked.orgId), slug: z.literal(quota.vercel.teamSlug), billing: z.object({ plan: z.literal("hobby") }) }).parse(teamEnvelope.team ?? teamEnvelope);
  assert.equal(team.id, linked.orgId);
  z.object({ id: z.literal(linked.projectId), accountId: z.literal(linked.orgId), name: z.literal("repoproof") }).parse(await providerGet("/v9/projects/" + linked.projectId));
  const currentInventory = z.object({ sandboxes: z.array(z.object({ name: z.string(), status: z.string(), persistent: z.boolean(), currentSessionId: z.string() })).max(1), pagination: z.object({ next: z.null() }) }).parse(await providerGet("/v2/sandboxes", { project: linked.projectId, limit: "50" }));
  if (priorStopped) {
    assert.equal(currentInventory.sandboxes.length, 1);
    assert.deepEqual(currentInventory.sandboxes[0], { name: priorStopped.name, status: "stopped", persistent: false, currentSessionId: priorStopped.sessionId });
    const previous = z.object({ sandbox: z.object({ name: z.literal(priorStopped.name), status: z.literal("stopped"), persistent: z.literal(false), image: z.literal(harmlessLimits.image), currentSessionId: z.literal(priorStopped.sessionId), currentSnapshotId: z.string().optional(), mounts: z.record(z.string(), z.unknown()).optional() }), session: z.object({ id: z.literal(priorStopped.sessionId), status: z.literal("stopped") }), routes: z.array(z.unknown()).length(0) }).parse(await providerGet("/v2/sandboxes/" + priorStopped.name, { projectId: linked.projectId, resume: "false" }));
    assert.equal(previous.sandbox.currentSnapshotId, undefined); assert.equal(Object.keys(previous.sandbox.mounts ?? {}).length, 0);
  } else { assert.equal(currentInventory.sandboxes.length, 0); assert.equal(inventory.sandboxRecordCount, 0); assert.equal(inventory.reviewedStoppedRecordCount, 0); }
  fresh(inventory.observedAtUtc, 120000); fresh(quota.observedAtUtc, 300000);
  const name = "rpf-harmless-" + randomUUID();
  const markerPath = join(evidence, ledger + ".claim.json"), eventsPath = join(evidence, ledger + ".events.jsonl"), receiptPath = join(evidence, ledger + ".receipt.json");
  let events: FileHandle | undefined, claimedHash: string | undefined;
  let runningObservation: { sessionId: string; status: string; observedAtUtc: string; routes: number; policy: string } | null = null;
  const observe = async (expectedStatus: "running" | "stopped") => {
    const raw = await providerGet("/v2/sandboxes/" + name, { projectId: linked.projectId, resume: "false" });
    if (raw === null) return null;
    const value = z.object({ sandbox: z.object({ name: z.literal(name), persistent: z.literal(false), image: z.literal(harmlessLimits.image), currentSessionId: z.string().min(1), status: z.literal(expectedStatus), currentSnapshotId: z.string().optional(), mounts: z.record(z.string(), z.unknown()).optional() }), session: z.object({ id: z.string().min(1), status: z.literal(expectedStatus), vcpus: z.literal(1), memory: z.literal(2048), timeout: z.literal(45000), networkPolicy: z.object({ mode: z.literal("deny-all") }) }), routes: z.array(z.unknown()).length(0) }).parse(raw);
    assert.equal(value.sandbox.currentSessionId, value.session.id); assert.equal(value.sandbox.currentSnapshotId, undefined); assert.equal(Object.keys(value.sandbox.mounts ?? {}).length, 0);
    return { sessionId: value.session.id, status: value.session.status, observedAtUtc: new Date().toISOString(), routes: value.routes.length, policy: value.session.networkPolicy.mode };
  };
  const control: HarmlessControl = {
    claim: async policySha256 => {
      fresh(quota.observedAtUtc, 300000); fresh(inventory.observedAtUtc, 120000);
      const marker = await open(markerPath, "wx", 0o600);
      try { await marker.writeFile(JSON.stringify({ status: "CONSUMED_NEVER_AUTO_REARM", claimedAtUtc: new Date().toISOString(), name, policySha256, teamFingerprint: inventory.teamFingerprint, projectFingerprint: digest(linked.projectId).slice(0, 16), quotaProofSha256: env.RPF_HARMLESS_QUOTA_SHA256, inventoryProofSha256: env.RPF_HARMLESS_INVENTORY_SHA256, ...(env.RPF_HARMLESS_REVIEWED_LOCAL_DENIAL_SHA256 ? { reviewedLocalDenialProofSha256: env.RPF_HARMLESS_REVIEWED_LOCAL_DENIAL_SHA256, preservedPriorClaimSha256: "bc0d03ea7bb58d15ab4565a330fb4c49cfff76150449c878aec753b443b9dfa7" } : {}), ...(env.RPF_HARMLESS_REVIEWED_STOPPED_ATTEMPT_SHA256 ? { reviewedStoppedAttemptSha256: env.RPF_HARMLESS_REVIEWED_STOPPED_ATTEMPT_SHA256, preservedPriorClaimSha256: "c89e33f6f528249233f507d706e8ae9762af0b023c2671081a5ccc159bfdde29" } : {}) })); await marker.sync(); }
      finally { await marker.close(); }
      claimedHash = policySha256; events = await open(eventsPath, "wx", 0o600); return true;
    },
    record: async event => {
      assert.equal(event.policySha256, claimedHash); assert.ok(events);
      await events.write(JSON.stringify({ ...event, observedAtUtc: new Date().toISOString() }) + "\n"); await events.sync();
      if (event.stage === "CREATED") { runningObservation = await observe("running"); assert.ok(runningObservation); }
    },
  };
  let receipt: HarmlessReceipt;
  try { receipt = await executeHarmlessSmoke({ name, teamId: linked.orgId, projectId: linked.projectId, token: auth.token }, control); }
  finally { await events?.close(); }
  let stopped: Awaited<ReturnType<typeof observe>> = null, observerFailed = false;
  if (receipt.cleanup.confirmed) { try { stopped = await observe("stopped"); } catch { observerFailed = true; } }
  const prior = runningObservation as { sessionId: string; status: string; observedAtUtc: string; routes: number; policy: string } | null;
  const providerCleanupConfirmed = !observerFailed && receipt.cleanup.confirmed && prior !== null && prior.sessionId === receipt.observation?.sessionId && (stopped === null || stopped.sessionId === prior.sessionId);
  const record = { observedAtUtc: new Date().toISOString(), receipt, independentChannel: "SAME_AUTHORITY_DIRECT_PROVIDER_GET_NOT_INDEPENDENT_PHYSICAL_ISOLATION", runningObservation: prior, stoppedObservation: stopped, providerCleanupConfirmed, observerFailed, providerNotFoundAfterAcknowledgedStop: !observerFailed && receipt.cleanup.confirmed && stopped === null, markerPath, neverAutoRearm: true, cashSpendUsd: 0, modelCalls: 0, fixtureExecutions: 0 };
  const serialized = JSON.stringify(record, null, 2); assert.ok(!serialized.includes(auth.token));
  const artifact = await open(receiptPath, "wx", 0o600); try { await artifact.writeFile(serialized); await artifact.sync(); } finally { await artifact.close(); }
  console.log(JSON.stringify({ status: receipt.status, providerCleanupConfirmed, commands: receipt.commands.length, receiptPath, receiptSha256: digest(serialized), rpf004Complete: false, fixtureExecutions: 0, modelCalls: 0, cashSpendUsd: 0, neverAutoRearm: true }));
  if (receipt.status !== "COMPLETE" || !providerCleanupConfirmed) process.exitCode = 1;
}
main().catch(() => { console.log(JSON.stringify({ status: "OPERATOR_UNCONFIRMED", action: "READ_CLAIM_AND_PROVIDER_STATE_NEVER_REPEAT_UNCERTAIN_CREATE", credentialsExposed: false })); process.exitCode = 1; });
