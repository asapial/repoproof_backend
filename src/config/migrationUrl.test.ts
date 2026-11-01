import { expect, it } from "vitest";
import { migrationUrl } from "./migrationUrl";

it("keeps migration owner credentials separate from runtime and permits generation without credentials", () => {
  expect(migrationUrl({})).toBeUndefined();
  expect(migrationUrl({ DATABASE_URL: "postgresql://runtime@localhost/runtime" })).toBe("postgresql://runtime@localhost/runtime");
  expect(migrationUrl({ DATABASE_URL: "postgresql://runtime@localhost/runtime", DIRECT_URL: "postgresql://owner@localhost/migrations" })).toBe("postgresql://owner@localhost/migrations");
});
it("rejects invalid explicit migration values without falling back or disclosing them", () => {
  for (const DIRECT_URL of ["", "https://owner:private-value@example.test/db", "postgresql://localhost/", "not-private-value"]) {
    let message = "";
    try { migrationUrl({ DIRECT_URL, DATABASE_URL: "postgresql://runtime@localhost/runtime" }); } catch (error) { message = String(error); }
    expect(message).toContain("DIRECT_URL"); expect(message).not.toContain("private-value");
  }
});
