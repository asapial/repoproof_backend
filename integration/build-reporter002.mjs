// Builds trusted instrumentation only. Never imports or executes fixture source.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

assert.equal(process.version, "v24.22.2");
const destination = process.argv[2];
assert.ok(destination && isAbsolute(destination), "Supply a fresh absolute output directory");
const output = resolve(destination), source = new URL("../src/verification/", import.meta.url);
// Do not overwrite a prior build, manifest, evidence directory or user file.
await mkdir(output, { recursive: false });
await build({
  entry: Object.fromEntries([["counter", "assertionCounter"], ["native-reporter", "nodeReporter"], ["protocol", "reporter"]]
    .map(([name, file]) => [name, fileURLToPath(new URL(`${file}.ts`, source))])),
  format: ["esm"], platform: "node", target: "node24", outDir: output,
  outExtension: () => ({ js: ".mjs" }), bundle: true, splitting: false,
  sourcemap: false, clean: false, metafile: true,
  // node:test is prefix-only. tsup's default removal produces an invalid import.
  removeNodeProtocol: false,
  noExternal: [/^@babel\//, /^zod(?:\/|$)/],
  banner: { js: 'import { createRequire as rpfCreateRequire } from "node:module"; const require = rpfCreateRequire(import.meta.url);' },
});
const files = [];
for (const name of ["counter.mjs", "native-reporter.mjs", "protocol.mjs"]) {
  const bytes = await readFile(resolve(output, name));
  files.push({ name, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const manifest = { purpose: "OFFLINE_INSTRUMENTATION_PREPARATION", node: process.version, files,
  fixtureCodeExecutions: 0, providerCalls: 0, liveImageBuilt: false };
await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify(manifest));
