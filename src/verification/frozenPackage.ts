import { z } from "zod";
import { freezeDiscountTest, generatedIssuePath, prepareBaseline, readSnapshot, sha256, type FrozenTest } from "./frozen";

const base64 = z.string().min(1).max(32000).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const packetSchema = z.object({ version: z.literal("rpf-frozen-package-v1"), purpose: z.literal("PREPARATION_ONLY"),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/), manifestBase64: base64,
  files: z.array(z.object({ path: z.enum(["src/discount.mjs", "tests/issue.mjs", "tests/regression.mjs", "tests/issue.generated.mjs"]), contentBase64: base64 }).strict()).length(4) }).strict();
function decode64(text: string): Buffer {
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) throw new Error("INVALID_FROZEN_PACKAGE");
  return bytes;
}
/** Exact-byte transport package, not a serialized execution or patch authority. */
export function encodeFrozenPackage(frozen: FrozenTest): Buffer {
  const files = readSnapshot(prepareBaseline(frozen));
  const packet = packetSchema.parse({ version: "rpf-frozen-package-v1", purpose: "PREPARATION_ONLY", manifestSha256: frozen.manifestSha256,
    manifestBase64: Buffer.from(JSON.stringify(frozen.manifest)).toString("base64"),
    files: files.map(file => ({ path: file.path, contentBase64: file.content.toString("base64") })) });
  const bytes = Buffer.from(JSON.stringify(packet));
  if (bytes.length > 65536) throw new Error("INVALID_FROZEN_PACKAGE");
  return bytes;
}
export function restoreFrozenPackage(input: Uint8Array): FrozenTest {
  try {
    if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > 65536) throw new Error();
    const bytes = Buffer.from(input), packet = packetSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)));
    if (!bytes.equals(Buffer.from(JSON.stringify(packet))) || new Set(packet.files.map(file => file.path)).size !== 4) throw new Error();
    const files = packet.files.map(file => ({ path: file.path, content: decode64(file.contentBase64) }));
    const test = files.find(file => file.path === generatedIssuePath)!;
    const frozen = freezeDiscountTest(files.filter(file => file.path !== generatedIssuePath), test.content);
    const manifest = decode64(packet.manifestBase64);
    if (sha256(manifest) !== packet.manifestSha256 || packet.manifestSha256 !== frozen.manifestSha256 ||
      !manifest.equals(Buffer.from(JSON.stringify(frozen.manifest))) || !bytes.equals(encodeFrozenPackage(frozen))) throw new Error();
    return frozen;
  } catch { throw new Error("INVALID_FROZEN_PACKAGE"); }
}
