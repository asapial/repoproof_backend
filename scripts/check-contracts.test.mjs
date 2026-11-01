import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { assertCurrentContracts } from "./check-contracts.mjs";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("accepts identical candidate and consumer snapshots", () => {
  vi.mocked(readFileSync).mockReturnValue(Buffer.from("identical bytes"));
  expect(() => assertCurrentContracts("backend", "frontend")).not.toThrow();
});
it("accepts Git's Windows CRLF checkout without normalizing consumer bytes", () => {
  vi.mocked(readFileSync).mockImplementation(path => Buffer.from(String(path).includes("vendor") ? "line\n" : "line\r\n"));
  expect(() => assertCurrentContracts("backend", "frontend")).not.toThrow();
  vi.mocked(readFileSync).mockReturnValue(Buffer.from("line\r\n"));
  expect(() => assertCurrentContracts("backend", "frontend")).toThrow();
});
it.each(["repoproof.ts", "v1.ts", "safeMvp.ts", "requestDraft.ts"])("rejects candidate drift in %s even if the historical pin matches", file => {
  vi.mocked(readFileSync).mockImplementation(path => Buffer.from(String(path).includes("vendor") && String(path).endsWith(file) ? "old snapshot" : "candidate bytes"));
  expect(() => assertCurrentContracts("backend", "frontend")).toThrow(file);
});
