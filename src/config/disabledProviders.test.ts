import { describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ envVars: { CLOUDINARY: null, OPENROUTER_ENABLED: false } }));
import { cloudinaryUpload, deleteFileFromCloudinary, uploadFileToCloudinary } from "./cloudinary.config";
import { getAiResponse } from "../utils/aiResponse";

describe("disabled external providers", () => {
  it("rejects cloud uploads and SDK access and skips cloud deletion", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(uploadFileToCloudinary(Buffer.from("safe"), "test.txt")).rejects.toThrow(/disabled/);
    await expect(deleteFileFromCloudinary("https://example.test/v1/test.png")).resolves.toBeUndefined();
    expect(() => cloudinaryUpload.uploader).toThrow(/disabled/);
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("rejects OpenRouter before trying any network request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getAiResponse({ context: "test", responseStyle: "json" })).rejects.toThrow(/disabled/);
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
});
