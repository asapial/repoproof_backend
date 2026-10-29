import { describe, expect, it } from "vitest";
import { safeFixtureCatalogSchema } from "./safeMvp";

const fixture = { repositoryId: "repoproof-backend", repository: "asapial/repoproof_backend", fixtureKey: "discount-bug", issueNumber: 1, source: "CURATED" };
describe("safe MVP fixture catalog contract", () => {
  it("accepts curated public metadata", () => {
    expect(safeFixtureCatalogSchema.parse({ repositories: [fixture] })).toEqual({ repositories: [fixture] });
  });
  it("rejects unsafe fields, invalid metadata, duplicate identifiers and excessive lists", () => {
    const cases: unknown[] = [
      { repositories: [{ ...fixture, path: "/private" }] },
      { repositories: [{ ...fixture, source: "LIVE" }] },
      { repositories: [{ ...fixture, issueNumber: 0 }] },
      { repositories: [{ ...fixture, repositoryId: "../repo" }] },
      { repositories: [fixture, fixture] },
      { repositories: [fixture, { ...fixture, fixtureKey: "other" }] },
      { repositories: Array.from({ length: 101 }, (_, i) => ({ ...fixture, repositoryId: `repo-${i}`, fixtureKey: `fixture-${i}` })) },
      { repositories: [fixture], secret: "token" },
    ];
    for (const value of cases) expect(safeFixtureCatalogSchema.safeParse(value).success).toBe(false);
  });
});
