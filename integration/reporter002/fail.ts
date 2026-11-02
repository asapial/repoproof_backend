// Deliberate trusted primitive assertion failure, not issue reproduction evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { installNodeAssertionCounter } from "../../src/verification/assertionCounter";
import { selfTestBlueprint, selfTestName } from "./shared";
installNodeAssertionCounter(selfTestBlueprint(fileURLToPath(import.meta.url)));
test(selfTestName,() => { assert.equal(1,1); assert.strictEqual(2,3); });
