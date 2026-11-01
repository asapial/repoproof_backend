import { executeOwnedSmoke } from "./adapter";
import { PostgresSmokeControl } from "./control";
import { loadOwnedFixture } from "./fixture";
import { smokeConfig } from "./policy";

// Server-internal harness, intentionally NOT registered on Express or /runs.
// headers must be the incoming trusted request Headers, never a claimed role.
export async function runAdminOwnedFixtureSmoke(headers: Headers, signal?: AbortSignal) {
  try {
    const config = smokeConfig(process.env);
    if (!config) return { status: "DISABLED" as const };
    if (!process.env.FRONTEND_URL || headers.get("origin") !== process.env.FRONTEND_URL) return { status: "FORBIDDEN" as const };
    const { auth } = await import("../lib/auth");
    const session = await auth.api.getSession({ headers });
    if (!session || session.user.id !== config.adminId) return { status: "FORBIDDEN" as const };
    const files = await loadOwnedFixture();
    const control = new PostgresSmokeControl(config.databaseUrl);
    try {
      const result = await executeOwnedSmoke(config, session.user.id, files, control, undefined, signal);
      // Fixed enumerated fields only. Do not log headers, errors, stdout or IDs.
      console.info(JSON.stringify({ event: "sandbox_smoke", status: result.status, cleanupConfirmed: result.cleanupConfirmed, commands: result.commands }));
      return result;
    } finally { await control.close(); }
  } catch {
    console.info(JSON.stringify({ event: "sandbox_smoke_unavailable" }));
    return { status: "UNAVAILABLE" as const };
  }
}
