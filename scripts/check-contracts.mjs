import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assertCurrentContracts(backend, frontend) {
  for (const file of ["repoproof.ts", "v1.ts", "safeMvp.ts", "requestDraft.ts"]) {
    // Git's text checkout can use CRLF on Windows. Canonicalize only those
    // byte pairs; keep every other byte and the vendored pinned bytes exact.
    const current = Buffer.from(readFileSync(resolve(backend, "src/contracts", file)).toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    const vendored = readFileSync(resolve(frontend, "src/contracts/vendor/v1", file));
    if (!current.equals(vendored)) throw new Error(`${file} differs from the candidate backend source`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const backend = fileURLToPath(new URL("..", import.meta.url));
  const frontend = process.env.REPOPROOF_FRONTEND;
  if (!frontend) throw new Error("Set REPOPROOF_FRONTEND to the reviewed frontend checkout");
  assertCurrentContracts(backend, frontend);
  execFileSync(process.execPath, [resolve(frontend, "scripts/check-contracts.mjs")], { stdio: "inherit", env: { ...process.env, REPOPROOF_BACKEND: backend } });
  console.log("Candidate backend source and pinned frontend contract both match");
}
