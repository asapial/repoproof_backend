import { createHash } from "node:crypto";
import { fixturePin, validateFixture, type FixtureFile } from "../sandbox/fixture";
import { admissibilityVersion, admitDiscount } from "./admissibility";

export const generatedIssuePath = "tests/issue.generated.mjs";
const sourcePath = "src/discount.mjs";
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type FileSeal = Readonly<{ path: string; sha256: string; byteLength: number; tests: number; assertions: number }>;
export type FrozenManifest = Readonly<{ version: "rpf-frozen-v1"; policy: typeof admissibilityVersion;
  fixtureKey: "discount-bug"; baseSha: string; issuePath: typeof generatedIssuePath; files: readonly FileSeal[] }>;
export type FrozenTest = Readonly<{ manifest: FrozenManifest; manifestSha256: string }>;
export type PreparedSnapshot = Readonly<{ stage: "BASELINE" | "PATCHED"; frozenManifestSha256: string;
  snapshotSha256: string; files: readonly FileSeal[] }>;
export type SourceChange = { path: string; previousSha256: string; content: Uint8Array };
export class FreezeError extends Error {
  constructor(readonly code: "INVALID_FIXTURE" | "INVALID_TEST" | "INVALID_HANDLE" | "PATCH_POLICY_VIOLATION") { super(code); }
}

// Object identity is intentional: serialized metadata cannot recreate a trusted
// handle. Buffers never leave these maps; all exported bytes are defensive copies.
const freezes = new WeakMap<FrozenTest, readonly FixtureFile[]>();
const snapshots = new WeakMap<PreparedSnapshot, { frozen: FrozenTest; files: readonly FixtureFile[] }>();
const copyFiles = (files: readonly FixtureFile[]) => files.map(file => ({ path: file.path, content: Buffer.from(file.content) }));
function frozenFiles(handle: FrozenTest) {
  const files = freezes.get(handle);
  if (!files) throw new FreezeError("INVALID_HANDLE");
  return files;
}
function sealFiles(files: readonly FixtureFile[]): readonly FileSeal[] {
  return Object.freeze(files.map(file => {
    const admission = admitDiscount(file.content, file.path === sourcePath ? "source" : file.path === "tests/regression.mjs" ? "regressions" : "issue");
    if (admission.status !== "ADMISSIBLE") throw new FreezeError("INVALID_TEST");
    return Object.freeze({ path: file.path, sha256: admission.sha256, byteLength: file.content.length, tests: admission.tests, assertions: admission.assertions });
  }));
}

/** Must complete before requesting any candidate patch. No execution occurs. */
export function freezeDiscountTest(owned: readonly FixtureFile[], generated: Uint8Array): FrozenTest {
  let files: FixtureFile[];
  try {
    if (!Array.isArray(owned) || owned.length !== 3 || owned.some(file => !(file.content instanceof Uint8Array) || file.content.byteLength > 24000)) throw new Error();
    files = validateFixture(copyFiles(owned));
  }
  catch { throw new FreezeError("INVALID_FIXTURE"); }
  if (!(generated instanceof Uint8Array) || generated.byteLength === 0 || generated.byteLength > 24000) throw new FreezeError("INVALID_TEST");
  files.push({ path: generatedIssuePath, content: Buffer.from(generated) });
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifest: FrozenManifest = Object.freeze({ version: "rpf-frozen-v1", policy: admissibilityVersion,
    fixtureKey: "discount-bug", baseSha: fixturePin, issuePath: generatedIssuePath, files: sealFiles(files) });
  const handle: FrozenTest = Object.freeze({ manifest, manifestSha256: sha256(Buffer.from(JSON.stringify(manifest))) });
  freezes.set(handle, files);
  return handle;
}
function snapshot(frozen: FrozenTest, files: readonly FixtureFile[], stage: PreparedSnapshot["stage"]): PreparedSnapshot {
  const seals = sealFiles(files);
  const handle = Object.freeze({ stage, frozenManifestSha256: frozen.manifestSha256, files: seals,
    snapshotSha256: sha256(Buffer.from(JSON.stringify({ frozenManifestSha256: frozen.manifestSha256, files: seals }))) });
  snapshots.set(handle, { frozen, files });
  return handle;
}
export function prepareBaseline(frozen: FrozenTest): PreparedSnapshot {
  return snapshot(frozen, frozenFiles(frozen), "BASELINE");
}

/** A source-only byte replacement, never a filesystem patch or model command. */
export function prepareDiscountPatch(frozen: FrozenTest, changes: readonly SourceChange[]): PreparedSnapshot {
  const originals = frozenFiles(frozen);
  if (!Array.isArray(changes) || changes.length !== 1) throw new FreezeError("PATCH_POLICY_VIOLATION");
  const change = changes[0];
  const original = originals.find(file => file.path === sourcePath)!;
  if (!change || Object.keys(change).sort().join(",") !== "content,path,previousSha256" || change.path !== sourcePath ||
    change.previousSha256 !== sha256(original.content) || !(change.content instanceof Uint8Array) ||
    change.content.byteLength === 0 || change.content.byteLength > 16000) throw new FreezeError("PATCH_POLICY_VIOLATION");
  const content = Buffer.from(change.content);
  if (content.equals(original.content) || admitDiscount(content, "source").status !== "ADMISSIBLE") throw new FreezeError("PATCH_POLICY_VIOLATION");
  const files = copyFiles(originals);
  files.find(file => file.path === sourcePath)!.content = content;
  return snapshot(frozen, files, "PATCHED");
}
export function readSnapshot(snapshot: PreparedSnapshot): FixtureFile[] {
  const state = snapshots.get(snapshot);
  if (!state) throw new FreezeError("INVALID_HANDLE");
  return copyFiles(state.files);
}

/** Compare independently collected artifact bytes to the complete sealed snapshot. */
export function snapshotBytesMatch(snapshot: PreparedSnapshot, observed: readonly FixtureFile[]): boolean {
  const expected = snapshots.get(snapshot);
  if (!expected) return false;
  try {
    if (!Array.isArray(observed) || observed.length !== expected.files.length || new Set(observed.map(file => file.path)).size !== observed.length) return false;
    return expected.files.every(file => {
      const other = observed.find(other => other.path === file.path);
      return other && other.content instanceof Uint8Array && other.content.byteLength === file.content.length && file.content.equals(Buffer.from(other.content));
    });
  } catch { return false; }
}
export function frozenTestsEquivalent(frozen: FrozenTest, baseline: PreparedSnapshot, patched: PreparedSnapshot): boolean {
  const before = snapshots.get(baseline), after = snapshots.get(patched), files = freezes.get(frozen);
  return !!before && !!after && !!files && before.frozen === frozen && after.frozen === frozen && baseline.stage === "BASELINE" && patched.stage === "PATCHED" &&
    files.filter(file => file.path !== sourcePath).every(file =>
      before.files.find(other => other.path === file.path)?.content.equals(file.content) && after.files.find(other => other.path === file.path)?.content.equals(file.content));
}
