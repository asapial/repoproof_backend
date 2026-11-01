import { createRequire } from "node:module";
import { expect, it } from "vitest";

it("preserves Vercel configuration parsing with patched Zod without reading credentials", () => {
  const require = createRequire(import.meta.url);
  const config = require("@vercel/cli-config") as { parseGlobalConfig: (input: unknown) => unknown; parseAuthConfig: (input: unknown) => unknown };
  expect(() => config.parseGlobalConfig({})).not.toThrow();
  expect(() => config.parseAuthConfig({ token: "synthetic-unit-only" })).not.toThrow();
  expect(() => config.parseGlobalConfig({ credStorage: 42 })).toThrow();
  expect(() => config.parseAuthConfig({ token: 42 })).toThrow();
});
