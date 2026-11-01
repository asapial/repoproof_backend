import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

// Owned pinned fixtures, not product repository fixtures or host executables.
export const isolationFiles = Object.freeze({
  "fixtures/isolation-owned/fail.mjs": "b60469b8bed642c1f9dd89e6b242acf7a750b2447bcb7c464876d27c31646a1d",
  "fixtures/isolation-owned/hold.mjs": "0f0f91ec679b20e050b2b73c5f932a96f62aa65bde8fc34dc703083b774dcefb",
  "fixtures/isolation-owned/probe.mjs": "3aa44bd4588582f12672a595c0dbc150475a29c97afea7cdb7a1ad28b2cba2cb"
});
export const isolationBundleSha256 = "a2959d4e6964d752cfc1b625835940b3ee053d0c930cadef6fb0dc369afd5750";
export async function loadIsolationBundle() {
  const root = resolve("fixtures/isolation-owned");
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Isolation fixture unavailable");
  const output: { path: string; content: Buffer }[] = [];
  for (const [path, expected] of Object.entries(isolationFiles)) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 32768) throw new Error("Isolation fixture unavailable");
    const content = await readFile(path);
    if (createHash("sha256").update(content).digest("hex") !== expected) throw new Error("Isolation fixture integrity failed");
    output.push({ path: path.replace("fixtures/isolation-owned/", ""), content });
  }
  return output;
}
