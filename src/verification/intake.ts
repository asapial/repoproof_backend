import { z } from "zod";
import { fixtureDigests, fixturePin, validateFixture, type FixtureFile } from "../sandbox/fixture";
import { admitDiscount } from "./admissibility";
import { sha256 } from "./frozen";
import { modelSourceSchema, type ModelSource } from "../meta/tasks";

export const ownedManifestSha256 = "08b07e6a1a3bae61a58eb55430a051aa4861e5f905f0f1742fdad32778b42a21";
// Node Buffers may have ArrayBufferLike backing; copy them before hashing.
const boundedBytes = (limit: number) => z.custom<Uint8Array<ArrayBufferLike>>(bytes =>
  bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= limit);
const issueSchema = z.object({ number: z.literal(1), title: z.string().min(1).max(500), body: z.string().min(1).max(16000) }).strict();
const inputSchema = z.object({ repository: z.literal("asapial/repoproof_backend"), fixtureKey: z.literal("discount-bug"),
  baseSha: z.literal(fixturePin), origin: z.literal("CURATED"), issue: issueSchema,
  manifestBytes: boundedBytes(16384), files: z.array(z.object({ path: z.enum(["src/discount.mjs", "tests/issue.mjs", "tests/regression.mjs"]),
    type: z.literal("blob"), mode: z.literal("100644"), content: boundedBytes(24000) }).strict()).length(3) }).strict();
export type OwnedSnapshotInput = z.infer<typeof inputSchema>;
export type OwnedSnapshot = Readonly<{ kind: "OWNED_PINNED_LOCAL_BYTES"; repository: "asapial/repoproof_backend";
  fixtureKey: "discount-bug"; baseSha: string; manifestSha256: string; snapshotSha256: string; networkVerified: false }>;
export class IntakeError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INTEGRITY_FAILED" | "INVALID_HANDLE") { super(code); }
}
const states = new WeakMap<OwnedSnapshot, { manifest: Buffer; files: FixtureFile[]; issue: z.infer<typeof issueSchema> }>();

/** Admit pre-fetched inert bytes only. No URL fetch, Git, shell, archive or code execution. */
export function intakeOwnedSnapshot(input: OwnedSnapshotInput): OwnedSnapshot {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new IntakeError("INVALID_INPUT");
  const value = parsed.data, manifest = Buffer.from(value.manifestBytes);
  if (sha256(manifest) !== ownedManifestSha256) throw new IntakeError("INTEGRITY_FAILED");
  let files: FixtureFile[];
  try {
    const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest));
    if (metadata.fixtureKey !== value.fixtureKey || metadata.pinnedBaseSha !== fixturePin || metadata.origin !== "CURATED" ||
      metadata.runtime.dependencies !== "none" || JSON.stringify(metadata.allowedPatchPaths) !== '["src/discount.mjs"]' ||
      Object.entries(fixtureDigests).some(([path, digest]) => metadata.sha256[path] !== digest)) throw new Error();
    files = validateFixture(value.files.map(file => ({ path: file.path, content: Buffer.from(file.content) })));
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    for (const file of files) if (admitDiscount(file.content, file.path.startsWith("src/") ? "source" : file.path.includes("regression") ? "regressions" : "issue").status !== "ADMISSIBLE") throw new Error();
  } catch { throw new IntakeError("INTEGRITY_FAILED"); }
  const identity = { repository: value.repository, fixtureKey: value.fixtureKey, baseSha: value.baseSha, manifestSha256: ownedManifestSha256 };
  const handle = Object.freeze({ kind: "OWNED_PINNED_LOCAL_BYTES" as const, ...identity, networkVerified: false as const,
    snapshotSha256: sha256(Buffer.from(JSON.stringify({ ...identity, issue: value.issue, files: files.map(file => ({ path: file.path, sha256: sha256(file.content) })) }))) });
  states.set(handle, { manifest, files, issue: Object.freeze({ ...value.issue }) });
  return handle;
}
function state(snapshot: OwnedSnapshot) {
  const stored = states.get(snapshot);
  if (!stored) throw new IntakeError("INVALID_HANDLE");
  return stored;
}
export function readOwnedSnapshot(snapshot: OwnedSnapshot): FixtureFile[] {
  return state(snapshot).files.map(file => ({ path: file.path, content: Buffer.from(file.content) }));
}
export function readOwnedManifest(snapshot: OwnedSnapshot): Buffer { return Buffer.from(state(snapshot).manifest); }

/** Issue text is data for the existing provider schema, never policy or instructions. */
export function ownedModelSource(snapshot: OwnedSnapshot): ModelSource {
  const stored = state(snapshot);
  return modelSourceSchema.parse({ baseSha: snapshot.baseSha, issue: { ...stored.issue },
    files: stored.files.filter(file => file.path.startsWith("src/")).map(file => ({ path: file.path,
      content: new TextDecoder("utf-8", { fatal: true }).decode(file.content), sha256: sha256(file.content) })) });
}
