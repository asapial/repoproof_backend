import { describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { requestDraftSchema, requestDraftResponseSchema } from "../contracts/requestDraft";
import { createDraftRouter, type DraftStore } from "./drafts";

const draft = { repositoryId: "repoproof-backend", fixtureKey: "discount-bug", issueNumber: 1 };
const store: DraftStore = { get: async () => null, put: async () => {}, delete: async () => {} };
describe("draft contract", () => {
  it("accepts only bounded selection fields", () => {
    expect(requestDraftResponseSchema.parse({ draft })).toEqual({ draft });
    for (const bad of [{ ...draft, userId: "another-user" }, { ...draft, issueNumber: 0 }, { ...draft, issueNumber: 2147483648 }, { ...draft, fixtureKey: "../escape" }]) expect(requestDraftSchema.safeParse(bad).success).toBe(false);
    expect(requestDraftResponseSchema.safeParse({ draft, status: "VERIFIED" }).success).toBe(false);
  });
  it("hides a saved fixture that is no longer approved", async () => {
    const app = express();
    app.use(createDraftRouter(async () => "user", { ...store, get: async () => ({ ...draft, fixtureKey: "revoked" }) }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/request-draft`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ draft: null });
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it("rejects malformed catalog settings before exposing routes", () => {
    expect(() => createDraftRouter(async () => "user", store, [{ ...draft, source: "CURATED", repository: "owner/repo", command: "ignored" }])).toThrow();
  });
});
