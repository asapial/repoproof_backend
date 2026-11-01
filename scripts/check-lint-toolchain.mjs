import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
// Each upgraded glob consumer uses minimatch's named CJS API. Exercise actual
// nested resolution so a package-manager deduplication cannot hide an old copy.
for (const consumer of ["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree"]) {
  const parent = dirname(require.resolve(consumer));
  const location = require.resolve("minimatch", { paths: [parent] });
  const { minimatch, Minimatch } = require(location);
  assert.equal(minimatch("src/config/env.ts", "src/**/*.ts"), true);
  assert.equal(new Minimatch("**/*.test.ts").match("src/config/env.ts"), false);
  assert.equal(new Minimatch("**/*.test.ts").match("src/config/env.test.ts"), true);
}
const eslint = new ESLint();
assert.equal(await eslint.isPathIgnored("prisma/generated/prisma/client.ts"), true);
const [good] = await eslint.lintText("export const n: number = 1;\n", { filePath: "src/toolchain-probe.ts" });
assert.equal(good.errorCount, 0);
const [bad] = await eslint.lintText("const unused: number = 1;\n", { filePath: "src/toolchain-probe.ts" });
assert.ok(bad.messages.some(message => message.ruleId === "@typescript-eslint/no-unused-vars"));
console.log("PASS: three patched glob consumers, generated-file exclusion and TypeScript positive/negative linting");
