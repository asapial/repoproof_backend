import { describe, expect, it } from "vitest";
import { jwtUtils } from "./jwt";

describe("JWT verification", () => {
  it("accepts a valid signed token", () => {
    const token = jwtUtils.createToken({ userId: "user-1" }, "test-secret", { expiresIn: "1h" });
    expect(jwtUtils.vefifyToken(token, "test-secret")).toMatchObject({ success: true, data: { userId: "user-1" } });
  });

  it("rejects an invalid signature and malformed token", () => {
    const token = jwtUtils.createToken({ userId: "user-1" }, "test-secret", { expiresIn: "1h" });
    expect(jwtUtils.vefifyToken(token, "other-secret").success).toBe(false);
    expect(jwtUtils.vefifyToken("invalid", "test-secret").success).toBe(false);
  });
});
