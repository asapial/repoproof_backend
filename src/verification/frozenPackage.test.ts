import { describe, expect, it } from "vitest";
import { loadOwnedFixture } from "../sandbox/fixture";
import { freezeDiscountTest, prepareBaseline, readSnapshot } from "./frozen";
import { encodeFrozenPackage, restoreFrozenPackage } from "./frozenPackage";

async function fixture() {
  const owned = await loadOwnedFixture(), generated = Buffer.from('import { test } from "node:test";\r\nimport assert from "node:assert/strict";\r\nimport { applyDiscount } from "../src/discount.mjs";\r\ntest("durable bytes", () => { assert.equal(applyDiscount(100, 20), 80); });\r\n');
  const frozen = freezeDiscountTest(owned, generated);
  return { frozen, bytes: encodeFrozenPackage(frozen) };
}
describe("canonical frozen byte package (no execution)", () => {
  it("roundtrips exact bytes, CRLF, manifest and original hashes after a process-style reload", async () => {
    const { frozen, bytes } = await fixture(), restored = restoreFrozenPackage(bytes);
    expect(restored).toEqual(frozen);
    expect(readSnapshot(prepareBaseline(restored))).toEqual(readSnapshot(prepareBaseline(frozen)));
    expect(encodeFrozenPackage(restored)).toEqual(bytes);
    bytes.fill(0);
    expect(encodeFrozenPackage(restored).length).toBeGreaterThan(0);
  });
  it.each(["path", "content", "manifest", "digest", "duplicate", "order", "mode", "base64"])("rejects package tampering at %s", async mutation => {
    const { bytes } = await fixture(), packet = JSON.parse(bytes.toString());
    if (mutation === "path") packet.files[0].path = "../src/discount.mjs";
    if (mutation === "content") packet.files[0].contentBase64 = Buffer.from("modified").toString("base64");
    if (mutation === "manifest") packet.manifestBase64 = Buffer.from("{}").toString("base64");
    if (mutation === "digest") packet.manifestSha256 = "0".repeat(64);
    if (mutation === "duplicate") packet.files[1] = packet.files[0];
    if (mutation === "order") packet.files.reverse();
    if (mutation === "mode") packet.files[0].mode = "120000";
    if (mutation === "base64") packet.files[0].contentBase64 += "==";
    expect(() => restoreFrozenPackage(Buffer.from(JSON.stringify(packet)))).toThrow("INVALID_FROZEN_PACKAGE");
  });
  it("fails closed on malformed, duplicate/unknown keys, noncanonical and oversized data", async () => {
    const { bytes } = await fixture(), raw = bytes.toString();
    for (const invalid of [Buffer.alloc(0), Buffer.alloc(65537), Buffer.from([0xff]), Buffer.from("{"), Buffer.from(raw + "\n"),
      Buffer.from("\uFEFF" + raw), Buffer.from(raw.replace('"version":', '"version":"rpf-frozen-package-v1","version":')),
      Buffer.from(raw.replace('"purpose":', '"verdict":"VERIFIED","purpose":'))]) {
      expect(() => restoreFrozenPackage(invalid)).toThrow("INVALID_FROZEN_PACKAGE");
    }
    const frozen = (await fixture()).frozen;
    expect(() => encodeFrozenPackage(JSON.parse(JSON.stringify(frozen)))).toThrow("INVALID_HANDLE");
  });
});
