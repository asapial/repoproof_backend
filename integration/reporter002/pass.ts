// Trusted numeric Node API self-test only. No fixture, generated source or patch.
import assert from "node:assert/strict";
import * as nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import { installNodeAssertionCounter } from "../../src/verification/assertionCounter";
import { selfTestBlueprint, selfTestName } from "./shared";
const file = fileURLToPath(import.meta.url), blueprint = selfTestBlueprint(file);
installNodeAssertionCounter(blueprint);
for (const name of ["equal","strictEqual"] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(assert,name);
  if (!descriptor || descriptor.writable || descriptor.configurable) throw new Error("Trusted counter protection missing");
}
let reinstallDenied = false;
try { installNodeAssertionCounter(blueprint); } catch { reinstallDenied = true; }
if (!reinstallDenied) throw new Error("Trusted counter installed twice");
nodeTest.test(selfTestName,() => {
  const getContext = Reflect.get(nodeTest,"getTestContext"), ctx = typeof getContext === "function" ? getContext() : undefined;
  if (!ctx || ctx.filePath !== file || ctx.name !== selfTestName) throw new Error("Trusted Node context ABI mismatch");
  assert.equal(1,1); assert.strictEqual(2,2);
});
