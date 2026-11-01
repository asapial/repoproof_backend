export const smokeLimits = Object.freeze({ lifetimeMs: 30_000, operationMs: 20_000, cleanupMs: 5_000, outputBytes: 16_384, fixtureBytes: 32_768, vcpus: 1 });

export type SmokeConfig = {
  enabled: true; adminId: string; projectId: string; teamId: string;
  token: string; image: string; nodeVersion: string; databaseUrl: string;
};

// Deliberately separate from SAFE MVP configuration: no public execution route.
export function smokeConfig(input: Readonly<Record<string, string | undefined>>): SmokeConfig | null {
  if (input.SANDBOX_SMOKE_ENABLED === undefined || input.SANDBOX_SMOKE_ENABLED === "false") return null;
  if (input.SANDBOX_SMOKE_ENABLED !== "true") throw new Error("Invalid sandbox configuration");
  if (input.DEBUG_FETCH === "true") throw new Error("Invalid sandbox configuration");
  const required = (name: string) => {
    const value = input[name];
    if (!value || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) throw new Error("Invalid sandbox configuration");
    return value;
  };
  const config: SmokeConfig = {
    enabled: true, adminId: required("SANDBOX_ADMIN_USER_ID"), projectId: required("SANDBOX_PROJECT_ID"),
    teamId: required("SANDBOX_TEAM_ID"), token: required("SANDBOX_TOKEN"), image: required("SANDBOX_IMAGE"),
    nodeVersion: required("SANDBOX_NODE_VERSION"), databaseUrl: required("SANDBOX_CONTROL_DATABASE_URL"),
  };
  if (!/^prj_[a-zA-Z0-9]+$/.test(config.projectId) || !/^team_[a-zA-Z0-9]+$/.test(config.teamId) ||
    !/^[a-z0-9][a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(config.image) ||
    !/^v24\.[0-9]+\.[0-9]+$/.test(config.nodeVersion)) throw new Error("Invalid sandbox configuration");
  return config;
}
