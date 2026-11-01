import { afterEach, expect, it, vi } from "vitest";
import { runAdminOwnedFixtureSmoke } from "./admin";
const mocks = vi.hoisted(() => ({ session: vi.fn(), execute: vi.fn(), close: vi.fn(), fixture: vi.fn() }));
vi.mock("../lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("./adapter", () => ({ executeOwnedSmoke: mocks.execute }));
vi.mock("./fixture", () => ({ loadOwnedFixture: mocks.fixture }));
vi.mock("./control", () => ({ PostgresSmokeControl: class { close = mocks.close; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });
function enable() {
  for (const [key, value] of Object.entries({ SANDBOX_SMOKE_ENABLED: "true", SANDBOX_ADMIN_USER_ID: "operator-id", SANDBOX_PROJECT_ID: "prj_owned", SANDBOX_TEAM_ID: "team_owned", SANDBOX_TOKEN: "synthetic-secret", SANDBOX_IMAGE: `registry.vercel.com/owned/node@sha256:${"a".repeat(64)}`, SANDBOX_NODE_VERSION: "v24.22.2", SANDBOX_CONTROL_DATABASE_URL: "postgresql://synthetic@localhost/disposable", FRONTEND_URL: "https://web.example" })) vi.stubEnv(key, value);
}
it("denies missing/foreign origin and forged role without any execution", async () => {
  enable();
  for (const headers of [new Headers(), new Headers({ origin: "https://evil.example", role: "admin" })]) expect(await runAdminOwnedFixtureSmoke(headers)).toEqual({ status: "FORBIDDEN" });
  expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("requires a real resolved session matching the operator-controlled user ID", async () => {
  enable(); const headers = new Headers({ origin: "https://web.example", role: "admin" });
  for (const session of [null, { user: { id: "ordinary-user" } }]) {
    mocks.session.mockResolvedValueOnce(session);
    expect(await runAdminOwnedFixtureSmoke(headers)).toEqual({ status: "FORBIDDEN" });
  }
  expect(mocks.fixture).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("passes only authenticated admin and validates fixture before the control connection", async () => {
  enable(); const headers = new Headers({ origin: "https://web.example", cookie: "private-cookie" });
  mocks.session.mockResolvedValue({ user: { id: "operator-id" } }); mocks.fixture.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({ status: "SMOKE_FINISHED", cleanupConfirmed: true, commands: 5 });
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  expect((await runAdminOwnedFixtureSmoke(headers)).status).toBe("SMOKE_FINISHED");
  expect(mocks.session).toHaveBeenCalledWith({ headers }); expect(mocks.execute.mock.calls[0]![1]).toBe("operator-id");
  expect(mocks.close).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-cookie|synthetic-secret/);
});
it("redacts auth/provider errors and closes its own connection", async () => {
  enable(); mocks.session.mockResolvedValue({ user: { id: "operator-id" } }); mocks.fixture.mockResolvedValue([]);
  mocks.execute.mockRejectedValue(new Error("private-cookie synthetic-secret"));
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  expect(await runAdminOwnedFixtureSmoke(new Headers({ origin: "https://web.example" }))).toEqual({ status: "UNAVAILABLE" });
  expect(mocks.close).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-cookie|synthetic-secret/);
});
