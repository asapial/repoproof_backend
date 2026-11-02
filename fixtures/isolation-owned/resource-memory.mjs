// OWNED NEGATIVE PROBE. Never import or run on the host, Docker or a web worker.
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
if (process.platform !== "linux" || !process.getuid || process.getuid() === 0 ||
  fileURLToPath(import.meta.url) !== "/vercel/sandbox/isolation/resource-memory.mjs") throw new Error("Approved isolated guest required");
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
if (Object.keys(input).sort().join(",") !== "mode,nonce,version" || input.version !== "rpf-resource-probe-v1" || input.mode !== "MEMORY_HARD_LIMIT" ||
  typeof input.nonce !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.nonce)) throw new Error("Invalid owned resource input");
const emit = (event, allocatedBytes) => process.stdout.write(JSON.stringify({ version: input.version,nonce: input.nonce,mode: input.mode,event,allocatedBytes })+"\n");
const retained = [], chunkBytes = 64*1024*1024, maximumBytes = 3*1024*1024*1024;
let allocatedBytes = 0;
emit("STARTED",allocatedBytes);
try {
  while (allocatedBytes < maximumBytes) {
    const chunk = Buffer.allocUnsafe(chunkBytes);
    // Touch each page. Allocation/virtual address success alone is insufficient.
    for (let page = 0; page < chunk.length; page += 4096) chunk[page] = ((page/4096+retained.length)%251)+1;
    retained.push(chunk); allocatedBytes += chunkBytes; emit("ALLOCATED",allocatedBytes);
  }
  emit("LIMIT_EXCEEDED",allocatedBytes); process.exitCode = 80;
} catch {
  // A language allocator failure does not prove provider/cgroup enforcement.
  emit("ALLOCATION_ERROR",allocatedBytes); process.exitCode = 82;
}
