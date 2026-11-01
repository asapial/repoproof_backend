import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { smokeLimits } from "./policy";

export const fixturePin = "1066351c5b07bed024775a16af9151048a9316b2";
export const fixtureDigests = Object.freeze({
  "src/discount.mjs": "8039e5c7c1adcc2b03f13b3aa6f66979bb916501ce2f7365b33ab4cb7e241825",
  "tests/issue.mjs": "cedda8bd3a847c877011eeb96391924c66d5adfa49cb2e68d5e3adc2be64962a",
  "tests/regression.mjs": "5cb2dcd4fbabecccc32c73d3cc041977ede0b36f5f2901e950607f08f5c0f82e",
});
export type FixtureFile = { path: string; content: Buffer };
export function validateFixture(files: FixtureFile[]): FixtureFile[] {
  if (files.length !== Object.keys(fixtureDigests).length) throw new Error("Fixture integrity failed");
  const seen = new Set<string>();
  // Copy validated bytes so caller mutation cannot change the uploaded fixture.
  return files.map(({ path, content }) => {
    const digest = fixtureDigests[path as keyof typeof fixtureDigests];
    if (!digest || seen.has(path) || content.length > smokeLimits.fixtureBytes || createHash("sha256").update(content).digest("hex") !== digest) throw new Error("Fixture integrity failed");
    seen.add(path);
    return { path, content: Buffer.from(content) };
  });
}
export async function loadOwnedFixture(): Promise<FixtureFile[]> {
  const root = resolve("fixtures/discount-bug");
  // A fixed path list only. No repository URL, caller path, archive or shell.
  for (const path of [root, resolve(root, "src"), resolve(root, "tests")]) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Fixture integrity failed");
  }
  const files: FixtureFile[] = [];
  for (const path of Object.keys(fixtureDigests)) {
    const fullPath = resolve(root, path);
    const stat = await lstat(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > smokeLimits.fixtureBytes) throw new Error("Fixture integrity failed");
    files.push({ path, content: await readFile(fullPath) });
  }
  return validateFixture(files);
}
