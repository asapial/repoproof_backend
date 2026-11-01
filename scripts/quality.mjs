import { spawnSync } from "node:child_process";

if (!process.env.npm_execpath) throw new Error("Run this gate with npm run check");
for (const args of [["run", "generate"], ["test", "--", "--maxWorkers=1"], ["run", "lint"], ["run", "typecheck"], ["run", "build"], ["audit", "--json"], ["audit", "--omit=dev", "--json"]]) {
  console.log(`CHECK: npm ${args.join(" ")}`);
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
const toolchain = spawnSync(process.execPath, ["scripts/check-lint-toolchain.mjs"], { stdio: "inherit" });
if (toolchain.error || toolchain.status !== 0) process.exit(toolchain.status ?? 1);
