import { constants as flags, openSync, closeSync, fstatSync, statfsSync, mkdirSync, fchmodSync, fsyncSync, readSync, writeSync, type Stats } from "node:fs";
import { platform, userInfo } from "node:os";
import { z } from "zod";
import { admitDiscount } from "../verification/admissibility";
import { readSnapshot, sha256, type PreparedSnapshot } from "../verification/frozen";
import { fixtureDigests } from "./fixture";

const paths = ["src/discount.mjs","tests/issue.generated.mjs","tests/issue.mjs","tests/regression.mjs"] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sealSchema = z.object({ path: z.enum(paths),sha256: digest,byteLength: z.number().int().min(1).max(24000),
  tests: z.number().int().min(0).max(16),assertions: z.number().int().min(0).max(512),contentBase64: z.string().min(1).max(32000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
const packetSchema = z.object({ version: z.literal("rpf-guest-preparation-v1"),instanceId: z.string().uuid().regex(/^[a-f0-9-]+$/),
  stage: z.enum(["BASELINE","PATCHED"]),frozenManifestSha256: digest,snapshotSha256: digest,files: z.array(sealSchema).length(4) }).strict();
type Packet = z.infer<typeof packetSchema>;
export type GuestPreparationResult = { ok: false;reason: "INVALID_PACKET" | "UNSUPPORTED" | "FILESYSTEM" } |
  { ok: true;value: Readonly<{ provenance: "UNVERIFIED_GUEST_PREPARATION";authentic: false;executionAllowed: false;
    instanceId: string;packetSha256: string;snapshotSha256: string;files: readonly Readonly<{ path: string;sha256: string;byteLength: number }>[] }> };

/** The server must hold the private prepared-snapshot handle. No model paths. */
export function encodeGuestPreparation(snapshot: PreparedSnapshot, instanceId: string): Buffer {
  const files = readSnapshot(snapshot);
  const packet = packetSchema.parse({ version: "rpf-guest-preparation-v1",instanceId,stage: snapshot.stage,
    frozenManifestSha256: snapshot.frozenManifestSha256,snapshotSha256: snapshot.snapshotSha256,
    files: snapshot.files.map(seal => ({ ...seal,contentBase64: files.find(file => file.path === seal.path)!.content.toString("base64") })) });
  const bytes = Buffer.from(JSON.stringify(packet)); if (bytes.length > 131072) throw new Error("INVALID_PACKET"); return bytes;
}
function decode(input: Uint8Array): { packet: Packet;contents: Buffer[];packetSha256: string } {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 131072) throw new Error();
  const copy = Buffer.from(input), packet = packetSchema.parse(JSON.parse(new TextDecoder("utf-8",{ fatal: true,ignoreBOM: true }).decode(copy)));
  if (!copy.equals(Buffer.from(JSON.stringify(packet))) || packet.files.some((f,i) => f.path !== paths[i])) throw new Error();
  const contents = packet.files.map(f => {
    const bytes = Buffer.from(f.contentBase64,"base64"), role = f.path.startsWith("src/") ? "source" : f.path === "tests/regression.mjs" ? "regressions" : "issue";
    const accepted = admitDiscount(bytes,role);
    if (bytes.toString("base64") !== f.contentBase64 || bytes.length !== f.byteLength || sha256(bytes) !== f.sha256 || accepted.status !== "ADMISSIBLE" ||
      accepted.tests !== f.tests || accepted.assertions !== f.assertions) throw new Error();
    const pinned = fixtureDigests[f.path as keyof typeof fixtureDigests];
    if (pinned && (packet.stage === "BASELINE" || role !== "source") && pinned !== f.sha256) throw new Error();
    return bytes;
  });
  const seals = packet.files.map(({ path,sha256,byteLength,tests,assertions }) => ({ path,sha256,byteLength,tests,assertions }));
  if (sha256(Buffer.from(JSON.stringify({ frozenManifestSha256: packet.frozenManifestSha256,files: seals }))) !== packet.snapshotSha256) throw new Error();
  return { packet,contents,packetSha256: sha256(copy) };
}
const at = (fd: number, name: string) => `/proc/self/fd/${fd}/${name}`;
const exactIdentity = (s: Stats) => Number.isSafeInteger(s.dev) && s.dev >= 0 && Number.isSafeInteger(s.ino) && s.ino > 0 && Number.isSafeInteger(s.uid) && s.uid >= 0;
const identity = (a: Stats,b: Stats) => exactIdentity(a) && exactIdentity(b) && a.dev === b.dev && a.ino === b.ino && a.uid === b.uid;
function directory(stat: Stats, uid: number, exactMode?: number) {
  if (!exactIdentity(stat) || !stat.isDirectory() || (stat.uid !== 0 && stat.uid !== uid) || (stat.mode & 0o022) || (exactMode !== undefined && (stat.uid !== uid || (stat.mode & 0o7777) !== exactMode))) throw new Error();
}
function regular(stat: Stats, uid: number, dev: number, size: number, mode: number) {
  if (!exactIdentity(stat) || !stat.isFile() || stat.uid !== uid || stat.dev !== dev || stat.nlink !== 1 || stat.size !== size || (stat.mode & 0o7777) !== mode) throw new Error();
}

/** Guest-only byte preparation. Never evaluates files or returns execution authority. */
export function prepareOwnedGuestFiles(input: Uint8Array): GuestPreparationResult {
  let checked: ReturnType<typeof decode>;
  try { checked = decode(input); } catch { return { ok: false,reason: "INVALID_PACKET" }; }
  let uid: number;
  try {
    uid = userInfo().uid;
    if (platform() !== "linux" || !Number.isSafeInteger(uid) || uid <= 0 || !flags.O_NOFOLLOW || !flags.O_DIRECTORY || !flags.O_NONBLOCK) return { ok: false,reason: "UNSUPPORTED" };
    // Linux PROC_SUPER_MAGIC; a regular directory is not a descriptor anchor.
    if (statfsSync("/proc").type !== 0x9fa0) return { ok: false,reason: "UNSUPPORTED" };
  } catch { return { ok: false,reason: "UNSUPPORTED" }; }
  const descriptors: number[] = [], dirFlags = flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_DIRECTORY | flags.O_NONBLOCK;
  const open = (path: string, value: number, mode?: number) => { const fd = openSync(path,value,mode); descriptors.push(fd); return fd; };
  let failed = false, result: GuestPreparationResult = { ok: false,reason: "FILESYSTEM" };
  try {
    // Fixed root only; every untrusted component is the final no-follow open.
    let root = open("/",dirFlags); directory(fstatSync(root),uid); if (fstatSync(root).uid !== 0) throw new Error();
    for (const name of ["vercel","sandbox"]) {
      root = open(at(root,name),dirFlags); const stat = fstatSync(root); directory(stat,uid);
      if (stat.uid !== (name === "vercel" ? 0 : uid)) throw new Error();
    }
    const rootStat = fstatSync(root); if (rootStat.uid !== uid) throw new Error();
    const name = `rpf-prepared-${checked.packet.instanceId}`;
    mkdirSync(at(root,name),{ mode: 0o700 }); // Exclusive; never reuse or remove.
    const destination = open(at(root,name),dirFlags), destinationStat = fstatSync(destination); directory(destinationStat,uid,0o700);
    if (destinationStat.dev !== rootStat.dev) throw new Error();
    const parents = new Map<string,{ fd: number;stat: Stats }>();
    for (const sub of ["src","tests"]) {
      mkdirSync(at(destination,sub),{ mode: 0o700 }); const fd = open(at(destination,sub),dirFlags), stat = fstatSync(fd);
      directory(stat,uid,0o700); if (stat.dev !== rootStat.dev) throw new Error(); parents.set(sub,{ fd,stat });
    }
    const created: { parent: number;name: string;stat: Stats;content: Buffer;path: string }[] = [];
    for (const [i,file] of checked.packet.files.entries()) {
      const [sub,leaf] = file.path.split("/") as [string,string], parent = parents.get(sub)!.fd, content = checked.contents[i]!;
      const fd = open(at(parent,leaf),flags.O_RDWR | flags.O_CREAT | flags.O_EXCL | flags.O_NOFOLLOW | flags.O_NONBLOCK,0o600);
      regular(fstatSync(fd),uid,rootStat.dev,0,0o600);
      let offset = 0;
      while (offset < content.length) { const written = writeSync(fd,content,offset,content.length-offset,offset); if (!Number.isInteger(written) || written <= 0 || written > content.length-offset) throw new Error(); offset += written; }
      fsyncSync(fd); regular(fstatSync(fd),uid,rootStat.dev,content.length,0o600);
      fchmodSync(fd,0o444); const stat = fstatSync(fd); regular(stat,uid,rootStat.dev,content.length,0o444);
      created.push({ parent,name: leaf,stat,content,path: file.path });
    }
    const observed: { path: string;sha256: string;byteLength: number }[] = [];
    for (const f of created) {
      const fd = open(at(f.parent,f.name),flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK), before = fstatSync(fd);
      regular(before,uid,rootStat.dev,f.content.length,0o444); if (!identity(before,f.stat)) throw new Error();
      const bytes = Buffer.alloc(f.content.length); let offset = 0;
      while (offset < bytes.length) { const n = readSync(fd,bytes,offset,bytes.length-offset,offset); if (!Number.isInteger(n) || n <= 0 || n > bytes.length-offset) throw new Error(); offset += n; }
      if (readSync(fd,Buffer.alloc(1),0,1,bytes.length) !== 0 || !bytes.equals(f.content)) throw new Error();
      const after = fstatSync(fd); regular(after,uid,rootStat.dev,bytes.length,0o444); if (!identity(before,after)) throw new Error();
      observed.push({ path: f.path,sha256: sha256(bytes),byteLength: bytes.length });
    }
    for (const [sub,p] of parents) {
      const fd = open(at(destination,sub),dirFlags); if (!identity(fstatSync(fd),p.stat)) throw new Error();
      fchmodSync(p.fd,0o555); directory(fstatSync(p.fd),uid,0o555); fsyncSync(p.fd);
    }
    const reopened = open(at(root,name),dirFlags); if (!identity(fstatSync(reopened),destinationStat)) throw new Error();
    fchmodSync(destination,0o555); directory(fstatSync(destination),uid,0o555); fsyncSync(destination); fsyncSync(root);
    observed.forEach(Object.freeze);
    result = { ok: true,value: Object.freeze({ provenance: "UNVERIFIED_GUEST_PREPARATION",authentic: false,executionAllowed: false,
      instanceId: checked.packet.instanceId,packetSha256: checked.packetSha256,snapshotSha256: checked.packet.snapshotSha256,files: Object.freeze(observed) }) };
  } catch { failed = true; }
  finally { for (const fd of descriptors.reverse()) { try { closeSync(fd); } catch { failed = true; } } }
  return failed ? { ok: false,reason: "FILESYSTEM" } : result;
}
