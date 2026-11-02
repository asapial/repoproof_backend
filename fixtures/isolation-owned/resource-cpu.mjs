// OWNED NEGATIVE PROBE. Only external approved command/VM termination stops it.
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, workerData } from "node:worker_threads";
if (process.platform !== "linux" || !process.getuid || process.getuid() === 0 ||
  fileURLToPath(import.meta.url) !== "/vercel/sandbox/isolation/resource-cpu.mjs") throw new Error("Approved isolated guest required");
if (!isMainThread) {
  if (!workerData || workerData.owned !== true || Object.keys(workerData).length !== 1) throw new Error("Invalid owned worker input");
  let value = 1;
  for (;;) value = Math.imul(value+1,1664525)^1013904223;
} else {
  const fd = openSync("/vercel/sandbox/resource-input.json",constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let bytes;
  try {
    const stat = fstatSync(fd), buffer = Buffer.alloc(1025);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 1024) throw new Error("Invalid owned resource input");
    const length = readSync(fd,buffer,0,buffer.length,0);
    if (length !== stat.size || fstatSync(fd).size !== stat.size) throw new Error("Invalid owned resource input");
    bytes = buffer.subarray(0,length);
  } finally { closeSync(fd); }
  const input = JSON.parse(bytes.toString("utf8"));
  if (Object.keys(input).sort().join(",") !== "mode,nonce,version" || input.version !== "rpf-resource-probe-v1" || input.mode !== "CPU_PRESSURE" ||
    typeof input.nonce !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.nonce)) throw new Error("Invalid owned resource input");
  const emit = event => process.stdout.write(JSON.stringify({ version: input.version,nonce: input.nonce,mode: input.mode,event,workers: 2 })+"\n");
  const workers = [new Worker(new URL(import.meta.url),{ workerData: { owned: true } }),new Worker(new URL(import.meta.url),{ workerData: { owned: true } })];
  let online = 0;
  for (const worker of workers) {
    worker.once("online",() => { online++; if (online === 2) emit("STARTED"); });
    worker.on("error",() => { emit("WORKER_ERROR"); process.exit(83); });
  }
  // No self-timeout or success exit can imitate external resource enforcement.
}
