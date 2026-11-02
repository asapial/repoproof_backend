import { createHash } from "node:crypto";
import { z } from "zod";
import { fixtureDigests, fixturePin } from "../sandbox/fixture";
import { intakeOwnedSnapshot, ownedManifestSha256, type OwnedSnapshot, type OwnedSnapshotInput } from "./intake";
import { sha256 } from "./frozen";
import { readStrictJson } from "./strictJson";

const api = "https://api.github.com/repos/asapial/repoproof_backend";
export const githubFixturePolicy = Object.freeze({ repository: "asapial/repoproof_backend", commit: fixturePin,
  tree: "79af84b2571665ed61b0bfe4ac00020cd1a0e8a3", apiVersion: "2026-03-10",
  blobs: Object.freeze({ "src/discount.mjs": "dc273c1d9e967465bc2a3df894f1a0b21736e1e2",
    "tests/issue.mjs": "88a111206f45d05541c1999c8339343e9b6c97fb", "tests/regression.mjs": "f3756fba8c5f6b104a7c11a86847b2f4356731cd" }) });
const gitSha = z.string().regex(/^[a-f0-9]{40}$/);
const treeSchema = z.object({ sha: z.literal(githubFixturePolicy.tree), truncated: z.literal(false), tree: z.array(z.object({
  path: z.string().min(1).max(512), mode: z.enum(["100644", "100755", "040000", "120000", "160000"]),
  type: z.enum(["blob", "tree", "commit"]), sha: gitSha, size: z.number().int().nonnegative().safe().optional(),
})).max(2048) });
const blobSchema = z.object({ sha: gitSha, encoding: z.literal("base64"), size: z.number().int().positive().max(24000), content: z.string().min(1).max(33000) });
const issueSchema = z.object({ number: z.literal(1), url: z.literal(api + "/issues/1"), repository_url: z.literal(api),
  html_url: z.literal("https://github.com/asapial/repoproof_backend/issues/1"), pull_request: z.never().optional(),
  title: z.string().min(1).max(500), body: z.string().min(1).max(16000) });
export class GitHubIntakeError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "INVALID_RESPONSE" | "INTEGRITY" | "UNAVAILABLE" | "TIMEOUT" | "CANCELLED") { super(code); }
  toJSON() { return { code: this.code }; }
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  void promise.catch(() => {}); signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Intake deadline")); signal.addEventListener("abort", abort, { once: true });
  })]); } finally { if (abort) signal.removeEventListener("abort", abort); }
}
function safePath(path: string) {
  return !/[\\:%\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

/** No default transport or credentials. Server code must explicitly supply a read transport. */
export class OwnedGitHubIntake {
  #transport: typeof fetch;
  constructor(transport: typeof fetch, private readonly timeoutMs = 5000) {
    if (typeof transport !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new GitHubIntakeError("INVALID_REQUEST");
    this.#transport = transport;
  }
  toJSON() { return { source: "owned-pinned-github-intake", credentials: false }; }
  async #json(url: string, limit: number, signal: AbortSignal, deadline: number): Promise<unknown> {
    const check = () => { signal.throwIfAborted(); if (performance.now() >= deadline) throw new GitHubIntakeError("TIMEOUT"); };
    check();
    const pending = Promise.resolve().then(() => { check(); return this.#transport(url, { method: "GET", redirect: "error", cache: "no-store", credentials: "omit", signal,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": githubFixturePolicy.apiVersion, "User-Agent": "RepoProof-owned-fixture-intake" } }); });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    let response: Response;
    try { response = await bounded(pending, signal); }
    catch (error) { if (signal.aborted || error instanceof GitHubIntakeError) throw error; throw new GitHubIntakeError("UNAVAILABLE"); }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      check(); if (response.status !== 200) throw new GitHubIntakeError("UNAVAILABLE");
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      const length = response.headers.get("content-length");
      if (response.redirected || (response.url && response.url !== url) || !["application/json", "application/vnd.github+json"].includes(type ?? "") ||
        (length !== null && (!/^(0|[1-9][0-9]{0,7})$/.test(length) || Number(length) > limit)) || !response.body) throw new GitHubIntakeError("INVALID_RESPONSE");
      reader = response.body.getReader();
      const chunks: Buffer[] = []; let total = 0;
      while (true) {
        check(); const item = await bounded(reader.read(), signal); check(); if (item.done) break;
        if (!(item.value instanceof Uint8Array) || (total += item.value.byteLength) > limit) throw new GitHubIntakeError("INVALID_RESPONSE");
        chunks.push(Buffer.from(item.value));
      }
      check();
      let value: unknown;
      try { value = readStrictJson(Buffer.concat(chunks, total), limit); } catch { throw new GitHubIntakeError("INVALID_RESPONSE"); }
      check(); return value;
    } finally {
      // A hostile/stalled cancellation promise must not extend the request budget.
      if (reader) void reader.cancel().catch(() => {});
      else void response.body?.cancel().catch(() => {});
    }
  }
  async load(manifestBytes: Uint8Array, externalSignal?: AbortSignal): Promise<OwnedSnapshot> {
    if (!(manifestBytes instanceof Uint8Array) || manifestBytes.byteLength === 0 || manifestBytes.byteLength > 16384) throw new GitHubIntakeError("INVALID_REQUEST");
    const manifest = Buffer.from(manifestBytes);
    if (sha256(manifest) !== ownedManifestSha256) throw new GitHubIntakeError("INTEGRITY");
    const controller = new AbortController(), cancel = () => controller.abort();
    if (externalSignal?.aborted) throw new GitHubIntakeError("CANCELLED");
    externalSignal?.addEventListener("abort", cancel, { once: true });
    const deadline = performance.now() + this.timeoutMs, timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const commit = z.object({ sha: z.literal(fixturePin), tree: z.object({ sha: z.literal(githubFixturePolicy.tree) }) })
        .parse(await this.#json(api + "/git/commits/" + fixturePin, 32768, controller.signal, deadline));
      if (commit.sha !== fixturePin) throw new GitHubIntakeError("INTEGRITY");
      const tree = treeSchema.parse(await this.#json(api + "/git/trees/" + githubFixturePolicy.tree + "?recursive=1", 524288, controller.signal, deadline));
      if (new Set(tree.tree.map(entry => entry.path)).size !== tree.tree.length || tree.tree.some(entry => !safePath(entry.path))) throw new GitHubIntakeError("INTEGRITY");
      const files: OwnedSnapshotInput["files"] = [];
      for (const [path, expectedBlob] of Object.entries(githubFixturePolicy.blobs)) {
        const entry = tree.tree.find(entry => entry.path === "fixtures/discount-bug/" + path);
        if (!entry || entry.mode !== "100644" || entry.type !== "blob" || entry.sha !== expectedBlob || entry.size === undefined || entry.size < 1 || entry.size > 24000) throw new GitHubIntakeError("INTEGRITY");
        const blob = blobSchema.parse(await this.#json(api + "/git/blobs/" + expectedBlob, 65536, controller.signal, deadline));
        const encoded = blob.content.replace(/\r?\n/g, "");
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new GitHubIntakeError("INTEGRITY");
        const content = Buffer.from(encoded, "base64");
        if (content.toString("base64") !== encoded || blob.sha !== expectedBlob || content.length !== blob.size || content.length !== entry.size ||
          createHash("sha1").update(Buffer.from(`blob ${content.length}\0`)).update(content).digest("hex") !== expectedBlob ||
          sha256(content) !== fixtureDigests[path as keyof typeof fixtureDigests]) throw new GitHubIntakeError("INTEGRITY");
        files.push({ path: path as OwnedSnapshotInput["files"][number]["path"], type: "blob", mode: "100644", content: Uint8Array.from(content) });
      }
      const issue = issueSchema.parse(await this.#json(api + "/issues/1", 131072, controller.signal, deadline));
      controller.signal.throwIfAborted();
      const snapshot = intakeOwnedSnapshot({ repository: "asapial/repoproof_backend", fixtureKey: "discount-bug", baseSha: fixturePin,
        origin: "CURATED", manifestBytes: Uint8Array.from(manifest), files, issue: { number: 1, title: issue.title, body: issue.body } });
      if (performance.now() >= deadline) throw new GitHubIntakeError("TIMEOUT");
      controller.signal.throwIfAborted(); return snapshot;
    } catch (error) {
      if (externalSignal?.aborted) throw new GitHubIntakeError("CANCELLED");
      if (controller.signal.aborted) throw new GitHubIntakeError("TIMEOUT");
      throw error instanceof GitHubIntakeError ? error : new GitHubIntakeError("INVALID_RESPONSE");
    } finally { clearTimeout(timer); controller.abort(); externalSignal?.removeEventListener("abort", cancel); }
  }
}
