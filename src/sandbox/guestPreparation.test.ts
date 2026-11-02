import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixturePin, loadOwnedFixture } from "./fixture";
import { MetaTaskProvider } from "../meta/tasks";
import { freezeDiscountTest, prepareBaseline, prepareDiscountPatch, sha256 } from "../verification/frozen";

type Entry = { kind: string;ino: number;dev: number;uid: number;mode: number;nlink: number;content: Buffer;children: Map<string,Entry>;opens: number };
const model = vi.hoisted(() => ({ platform: "linux",uid: 1000,attack: "",nextInode: 1,nextFd: 10,root: undefined as Entry | undefined,
  descriptors: new Map<number,Entry>(),operations: [] as string[],maxWrite: 99999,maxRead: 99999 }));
const constants = vi.hoisted(() => ({ O_RDONLY: 0,O_RDWR: 2,O_CREAT: 64,O_EXCL: 128,O_NOFOLLOW: 131072,O_DIRECTORY: 65536,O_NONBLOCK: 2048 }));
function entry(kind = "dir",uid = 1000,mode = 0o700): Entry { return { kind,ino: model.nextInode++,dev: 1,uid,mode,nlink: 1,content: Buffer.alloc(0),children: new Map(),opens: 0 }; }
function pathNode(path: string) {
  const match = /^\/proc\/self\/fd\/(\d+)\/([^/]+)$/.exec(path); if (!match) throw new Error("Unsafe modeled path");
  const parent = model.descriptors.get(Number(match[1])); if (!parent || parent.kind !== "dir") throw new Error("Invalid modeled directory descriptor");
  return { parent,leaf: match[2]! };
}
vi.mock("node:os",() => ({ platform: () => model.platform,userInfo: () => ({ uid: model.uid }) }));
vi.mock("node:fs",() => ({ constants,
  statfsSync(path: string) { if (path !== "/proc") throw new Error("Unexpected modeled filesystem lookup"); return { type: model.attack === "procfs" ? 0 : 0x9fa0 }; },
  openSync(path: string,flags: number,mode?: number) {
    model.operations.push("open "+path); if (!(flags & constants.O_NOFOLLOW) || !(flags & constants.O_NONBLOCK)) throw new Error("Missing modeled no-follow flag");
    let node: Entry;
    if (path === "/") node = model.root!;
    else {
      const { parent,leaf } = pathNode(path);
      const previous = parent.children.get(leaf);
      if (flags & constants.O_CREAT) {
        if (!(flags & constants.O_EXCL)) throw new Error("Nonexclusive modeled creation");
        if (previous || ["fileExists","fileSymlink"].includes(model.attack)) throw new Error("SENSITIVE existing path");
        node = entry(model.attack === "fifo" ? "fifo" : "file",model.attack === "owner" ? 0 : model.uid,model.attack === "permission" ? 0o666 : mode);
        if (model.attack === "hardlink") node.nlink = 2;
        if (model.attack === "device") node.dev = 2;
        if (model.attack === "unsafeInode") node.ino = Number.MAX_SAFE_INTEGER+1;
        parent.children.set(leaf,node);
      } else {
        if (!previous) throw new Error("Missing modeled path"); node = previous;
        if ((model.attack === "replacement" && node.kind === "file") || (model.attack === "parentReplacement" && leaf === "src" && node.opens > 0) ||
          (model.attack === "destinationReplacement" && leaf.startsWith("rpf-prepared-") && node.opens > 0)) {
          node = { ...node,ino: model.nextInode++ }; parent.children.set(leaf,node);
        }
      }
    }
    if (node.kind === "symlink" || ((flags & constants.O_DIRECTORY) && node.kind !== "dir")) throw new Error("SENSITIVE modeled link denied");
    node.opens++; const fd = model.nextFd++; model.descriptors.set(fd,node); return fd;
  },
  mkdirSync(path: string,options: { mode: number }) {
    model.operations.push("mkdir "+path); const { parent,leaf } = pathNode(path);
    if (parent.children.has(leaf) || model.attack === "existingDestination") throw new Error("Existing modeled directory");
    parent.children.set(leaf,entry(model.attack === "parentSymlink" && leaf === "src" ? "symlink" : "dir",model.uid,options.mode));
  },
  fstatSync(fd: number) { const node = model.descriptors.get(fd)!; return { ...node,size: node.content.length,isDirectory: () => node.kind === "dir",isFile: () => node.kind === "file" }; },
  fchmodSync(fd: number,mode: number) {
    const node = model.descriptors.get(fd)!; node.mode = mode;
    if (node.kind === "file" && mode === 0o444 && model.attack === "contentMutation") node.content[0] = node.content[0]! ^ 1;
    if (node.kind === "file" && mode === 0o444 && model.attack === "append") node.content = Buffer.concat([node.content,Buffer.from("x")]);
  },
  fsyncSync() { if (model.attack === "fsync") throw new Error("SENSITIVE modeled I/O failure"); },
  writeSync(fd: number,bytes: Buffer,offset: number,length: number,position: number) {
    if (model.attack === "writeZero") return 0; const node = model.descriptors.get(fd)!, size = Math.min(length,model.maxWrite);
    const content = Buffer.alloc(Math.max(node.content.length,position+size)); node.content.copy(content); bytes.copy(content,position,offset,offset+size); node.content = content; return size;
  },
  readSync(fd: number,bytes: Buffer,offset: number,length: number,position: number) {
    if (model.attack === "readZero") return 0; const node = model.descriptors.get(fd)!, size = Math.min(length,model.maxRead,Math.max(0,node.content.length-position));
    node.content.copy(bytes,offset,position,position+size); return size;
  },
  closeSync(fd: number) { model.descriptors.delete(fd); if (model.attack === "close") throw new Error("SENSITIVE modeled close failure"); },
}));
import { encodeGuestPreparation, prepareOwnedGuestFiles } from "./guestPreparation";

const instanceId = "10000000-0000-4000-8000-000000000001";
async function fixture() {
  const files = await loadOwnedFixture(), source = files.find(file => file.path === "src/discount.mjs")!;
  const frozen = freezeDiscountTest(files,Buffer.from('import { test } from "node:test"; import assert from "node:assert/strict"; import { applyDiscount } from "../src/discount.mjs"; test("guest preparation data", () => { assert.equal(applyDiscount(100, 20), 80); });'));
  const baseline = prepareBaseline(frozen), patched = prepareDiscountPatch(frozen,[{ path: source.path,previousSha256: sha256(source.content),
    content: Buffer.from('export function applyDiscount(price, percentage) { return price - price * percentage / 100; }') }]);
  return { baseline,patched,packet: encodeGuestPreparation(baseline,instanceId) };
}
beforeEach(() => {
  model.platform = "linux"; model.uid = 1000; model.attack = ""; model.nextFd = 10; model.nextInode = 1; model.descriptors.clear(); model.operations.length = 0; model.maxWrite = model.maxRead = 99999;
  model.root = entry("dir",0,0o755); const vercel = entry("dir",0,0o755); vercel.children.set("sandbox",entry("dir",1000,0o755)); model.root.children.set("vercel",vercel);
});
describe("guest byte preparation (modeled filesystem only; no fixture execution)", () => {
  it("keeps the actual helper path protected from model proposals before any catalog/provider call", async () => {
    const list = vi.fn(), generate = vi.fn(), provider = new MetaTaskProvider("synthetic",{ list },{ generate });
    const content = "export const privateHelper = 1;", path = "src/sandbox/guestPreparation.ts";
    await expect(provider.generateSourcePatch({ baseSha: fixturePin,issue: { number: 1,title: "Synthetic",body: "Inert owned data" },
      files: [{ path,content,sha256: sha256(Buffer.from(content)) }] },[path])).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(list).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("creates a fresh exact-byte immutable tree with fixed descriptor-relative paths and no execution authority", async () => {
    const { packet } = await fixture(), result = prepareOwnedGuestFiles(packet);
    expect(result).toMatchObject({ ok: true,value: { authentic: false,executionAllowed: false,provenance: "UNVERIFIED_GUEST_PREPARATION",packetSha256: sha256(packet) } });
    const root = model.root!.children.get("vercel")!.children.get("sandbox")!.children.get("rpf-prepared-"+instanceId)!;
    expect(root.mode).toBe(0o555); expect(root.children.get("tests")!.mode).toBe(0o555);
    for (const file of JSON.parse(packet.toString()).files) {
      const [parent,name] = file.path.split("/"), saved = root.children.get(parent)!.children.get(name)!;
      expect(saved.mode).toBe(0o444); expect(sha256(saved.content)).toBe(file.sha256);
    }
    expect(model.descriptors.size).toBe(0); expect(model.operations.filter(op => op.startsWith("open ")).every(op => op === "open /" || /^open \/proc\/self\/fd\/\d+\/[^/]+$/.test(op))).toBe(true);
    expect(prepareOwnedGuestFiles(packet)).toEqual({ ok: false,reason: "FILESYSTEM" });
  });
  it("handles partial reads/writes and keeps baseline/patched test bytes equal", async () => {
    const { packet,patched } = await fixture(); model.maxWrite = 7; model.maxRead = 11;
    expect(prepareOwnedGuestFiles(packet).ok).toBe(true);
    const next = encodeGuestPreparation(patched,"20000000-0000-4000-8000-000000000001"); expect(prepareOwnedGuestFiles(next).ok).toBe(true);
    expect(JSON.parse(packet.toString()).files.filter((f: { path: string }) => f.path.startsWith("tests/"))).toEqual(JSON.parse(next.toString()).files.filter((f: { path: string }) => f.path.startsWith("tests/")));
  });
  it.each(["parentSymlink","fileSymlink","fileExists","hardlink","device","unsafeInode","fifo","permission","owner","append","contentMutation","replacement","parentReplacement","destinationReplacement","existingDestination","fsync","writeZero","readZero","close"])
  ("fails closed for modeled attack/fault %s and closes all handles", async attack => {
    const { packet } = await fixture(); model.attack = attack; expect(prepareOwnedGuestFiles(packet)).toEqual({ ok: false,reason: "FILESYSTEM" }); expect(model.descriptors.size).toBe(0);
  });
  it("rejects linked/world-writable/root-owned workspace ancestry before creating files", async () => {
    const { packet } = await fixture(), vercel = model.root!.children.get("vercel")!, root = vercel.children.get("sandbox")!;
    vercel.kind = "symlink"; expect(prepareOwnedGuestFiles(packet).ok).toBe(false); vercel.kind = "dir";
    vercel.mode = 0o777; expect(prepareOwnedGuestFiles(packet).ok).toBe(false); vercel.mode = 0o755;
    root.uid = 0; expect(prepareOwnedGuestFiles(packet).ok).toBe(false); expect(root.children.size).toBe(0); expect(model.descriptors.size).toBe(0);
  });
  it("requires procfs descriptor anchors rather than a caller-created ordinary directory", async () => {
    const { packet } = await fixture(); model.attack = "procfs";
    expect(prepareOwnedGuestFiles(packet)).toEqual({ ok: false,reason: "UNSUPPORTED" }); expect(model.operations).toHaveLength(0);
  });
  it.each(["win32","darwin","root","missingFlags"])("has no filesystem fallback for unsupported runtime %s", async runtime => {
    const { packet } = await fixture(), saved = constants.O_NOFOLLOW;
    if (runtime === "root") model.uid = 0; else if (runtime === "missingFlags") constants.O_NOFOLLOW = 0; else model.platform = runtime;
    try { expect(prepareOwnedGuestFiles(packet)).toEqual({ ok: false,reason: "UNSUPPORTED" }); expect(model.operations).toHaveLength(0); }
    finally { constants.O_NOFOLLOW = saved; }
  });
  it.each(["path","duplicate","sha","base64","counts","snapshot","pinnedTest","globalMutation","baselinePatch"])("rejects malformed or unsafe packet %s before touching the filesystem", async attack => {
    const { packet } = await fixture(), p = JSON.parse(packet.toString());
    if (attack === "path") p.files[0].path = "../escape";
    if (attack === "duplicate") p.files[1].path = p.files[0].path;
    if (attack === "sha") p.files[0].sha256 = "0".repeat(64);
    if (attack === "base64") p.files[0].contentBase64 += "=";
    if (attack === "counts") p.files[1].assertions = 0;
    if (attack === "snapshot") p.snapshotSha256 = "0".repeat(64);
    if (["pinnedTest","globalMutation","baselinePatch"].includes(attack)) {
      const f = p.files[attack === "pinnedTest" ? 2 : 0], content = Buffer.from(attack === "globalMutation" ? 'export function applyDiscount(price, percentage) { globalThis.escape = 1; return price; }' :
        attack === "baselinePatch" ? 'export function applyDiscount(price, percentage) { return price - price * percentage / 100; }' : Buffer.from(f.contentBase64,"base64").toString().replace(/test\("/, 'test("changed '));
      f.contentBase64 = content.toString("base64"); f.byteLength = content.length; f.sha256 = sha256(content); if (attack !== "baselinePatch") p.stage = "PATCHED";
    }
    expect(prepareOwnedGuestFiles(Buffer.from(JSON.stringify(p)))).toEqual({ ok: false,reason: "INVALID_PACKET" }); expect(model.operations).toHaveLength(0);
  });
  it("rejects malformed bytes, duplicate keys, unknown permission claims and forged snapshot handles", async () => {
    const { packet,baseline } = await fixture();
    for (const value of [Buffer.from(" "+packet),Buffer.from(packet.toString().replace('"version":','"version":"duplicate","version":')),
      Buffer.from(packet.toString().replace('"files":','"executionAllowed":true,"files":')),Buffer.alloc(131073),Uint8Array.of(0xff)]) {
      expect(prepareOwnedGuestFiles(value)).toEqual({ ok: false,reason: "INVALID_PACKET" });
    }
    expect(() => encodeGuestPreparation(JSON.parse(JSON.stringify(baseline)),instanceId)).toThrow(); expect(model.operations).toHaveLength(0);
  });
});
