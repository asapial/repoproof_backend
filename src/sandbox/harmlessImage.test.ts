import { describe, expect, it, vi } from "vitest";
import { executeHarmlessSmoke, harmlessLimits, type HarmlessInstance, type HarmlessProvider } from "./harmless";

// Exact image identity returned by the owned provider GET after the first VM.
// Provider metadata is an observation, not independent kernel/isolation proof.
const image = "vercel/sandbox/node@sha256:dd20407070335f1605d474df72a4fc6a42d663526d1f915387a06cdbf167c0eb";
const config = { name: "rpf-harmless-digest-offline", teamId: "team_owned", projectId: "prj_owned", token: "synthetic-image-only-token" };
function instance(observedImage: string): HarmlessInstance {
  return { observe: () => ({ name: config.name, sessionId: "owned", image: observedImage, networkPolicy: "deny-all", persistent: false, vcpus: 1, memoryMb: 2048, timeoutMs: 45000, mountCount: 0, currentSnapshot: null }),
    run: vi.fn(async (kind, stdout) => {
      if (kind === "identity") stdout.write(JSON.stringify({ marker: "RPF_HARMLESS_V1", node: "v24.22.2", platform: "linux", arch: "x64" }));
      return { commandId: kind, exitCode: kind === "identity" ? 0 : 137, durationMs: kind === "identity" ? 20 : 510 };
    }), cancel: vi.fn(async () => ({ commandId: "cancel", exitCode: 137, durationMs: 50 })),
    stop: vi.fn(async () => ({ sessionId: "owned", status: "stopped", snapshotCreated: false })) };
}
describe("harmless exact resolved image contract — synthetic commands", () => {
  it("requests and accepts only the observed immutable digest before executing commands", async () => {
    const target = instance(image), create = vi.fn<HarmlessProvider["create"]>(async () => target);
    const receipt = await executeHarmlessSmoke(config, { claim: async () => true, record: async () => {} }, { create });
    expect(receipt.status).toBe("COMPLETE"); expect(create.mock.calls[0]?.[0]).toMatchObject({ image });
    expect(receipt.observation?.image).toBe(image); expect(receipt.cleanup.confirmed).toBe(true); expect(receipt.commands).toHaveLength(3);
  });
  it("stops any different digest before running even the harmless identity command", async () => {
    const target = instance(image.replace(/.$/, "0"));
    const receipt = await executeHarmlessSmoke(config, { claim: async () => true, record: async () => {} }, { create: async () => target });
    expect(receipt.status).toBe("CLEANUP_UNKNOWN"); expect(target.run).not.toHaveBeenCalled(); expect(target.stop).toHaveBeenCalledTimes(1);
    expect(harmlessLimits.image).not.toBe(image.replace(/.$/, "0"));
  });
});
