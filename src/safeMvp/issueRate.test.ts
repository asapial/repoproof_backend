import { describe, expect, it, vi } from "vitest";
import { issuePreviewLimiter } from "./issueRate";

describe("shared issue-preview admission", () => {
  it("requires both owner and global PostgreSQL admissions with bounded rules", async () => {
    const storage = { consume: vi.fn(async () => ({ allowed: true })) };
    expect(await issuePreviewLimiter(storage)("owned-user")).toBe(true);
    expect(storage.consume.mock.calls).toEqual([
      ["github-preview:user:owned-user", { window: 900, max: 2 }], ["github-preview:global", { window: 900, max: 5 }],
    ]);
  });
  it("fails closed for individual/global exhaustion and SQL failure without fallback", async () => {
    const consume = vi.fn().mockResolvedValueOnce({ allowed: false });
    expect(await issuePreviewLimiter({ consume })("owned")).toBe(false); expect(consume).toHaveBeenCalledTimes(1);
    consume.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    expect(await issuePreviewLimiter({ consume })("owned")).toBe(false);
    consume.mockRejectedValueOnce(new Error("SENSITIVE database error"));
    expect(await issuePreviewLimiter({ consume })("owned")).toBe(false);
  });
  it("rejects unsafe identity before consuming any quota", async () => {
    const consume = vi.fn();
    for (const id of ["", "../other", "x".repeat(129), "owner\nother"]) expect(await issuePreviewLimiter({ consume })(id)).toBe(false);
    expect(consume).not.toHaveBeenCalled();
  });
});
