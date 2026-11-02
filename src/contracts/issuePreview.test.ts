import { describe, expect, it } from "vitest";
import { issuePreviewSchema } from "./issuePreview";

const valid = () => ({ repositoryId: "repoproof-backend", repository: "asapial/repoproof_backend", fixtureKey: "discount-bug",
  baseSha: "1066351c5b07bed024775a16af9151048a9316b2", source: "GITHUB_API", fetchedAt: "2026-11-02T00:00:00.000Z",
  issues: [{ number: 1, title: "Issue title", body: "Untrusted issue text <script>alert(1)</script>", url: "https://github.com/asapial/repoproof_backend/issues/1" }] });
describe("read-only issue preview contract", () => {
  it("keeps issue text as bounded data without adding execution facts", () => {
    expect(issuePreviewSchema.parse(valid())).toEqual(valid());
  });
  it.each(["repositoryId", "repository", "fixtureKey", "baseSha", "source", "fetchedAt"])("rejects changed %s binding", field => {
    expect(issuePreviewSchema.safeParse({ ...valid(), [field]: "untrusted" }).success).toBe(false);
  });
  it.each(["number", "url", "title", "body"])("rejects an invalid issue %s", field => {
    const value = valid(); Object.assign(value.issues[0]!, { [field]: field === "number" ? 2 : field === "url" ? "https://evil.invalid" : "" });
    expect(issuePreviewSchema.safeParse(value).success).toBe(false);
  });
  it("rejects extra issues, overflow and privileged/provenance extensions", () => {
    const value = valid();
    for (const input of [{ ...value, issues: [] }, { ...value, issues: [...value.issues, ...value.issues] },
      { ...value, verdict: "VERIFIED" }, { ...value, authentic: true },
      { ...value, issues: [{ ...value.issues[0], title: "x".repeat(501) }] },
      { ...value, issues: [{ ...value.issues[0], body: "x".repeat(16001) }] },
      { ...value, issues: [{ ...value.issues[0], pull_request: {} }] }]) expect(issuePreviewSchema.safeParse(input).success).toBe(false);
  });
});
