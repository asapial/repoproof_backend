// Trusted deny-path check on the Windows controller. Fixture bytes are inert data.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { platform } from "node:os";
import { loadOwnedFixture } from "../src/sandbox/fixture";
import { freezeDiscountTest, prepareBaseline } from "../src/verification/frozen";
import { encodeGuestPreparation, prepareOwnedGuestFiles } from "../src/sandbox/guestPreparation";

assert.equal(platform(),"win32","this actual controller deny gate requires Windows");
const files = await loadOwnedFixture(), frozen = freezeDiscountTest(files,Buffer.from('import { test } from "node:test"; import assert from "node:assert/strict"; import { applyDiscount } from "../src/discount.mjs"; test("host gate inert data", () => { assert.equal(applyDiscount(100, 20), 80); });'));
const packet = encodeGuestPreparation(prepareBaseline(frozen),"10000000-0000-4000-8000-000000000001");
const originalOpen = fs.openSync, originalMkdir = fs.mkdirSync; let filesystemCalls = 0;
try {
  // Any attempted access is blocked in this trusted test process before touching
  // the host. This never imports/evaluates any file represented in the packet.
  fs.openSync = () => { filesystemCalls++; throw new Error("Unexpected controller filesystem access"); };
  fs.mkdirSync = () => { filesystemCalls++; throw new Error("Unexpected controller directory creation"); };
  syncBuiltinESMExports();
  assert.deepEqual(prepareOwnedGuestFiles(packet),{ ok: false,reason: "UNSUPPORTED" });
  assert.equal(filesystemCalls,0);
} finally { fs.openSync = originalOpen; fs.mkdirSync = originalMkdir; syncBuiltinESMExports(); }
console.log(JSON.stringify({ result: "PASS",actualControllerPlatform: "win32",guestFilesystemCalls: filesystemCalls,fixtureCodeExecutions: 0,liveSandboxes: 0 }));
