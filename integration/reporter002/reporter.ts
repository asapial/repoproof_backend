// Adapter for the two explicit trusted instrumentation files only.
import { tsImport } from "tsx/esm/api";
// Node loads reporter modules before ordinary --import hooks. This explicit
// trusted-module loader handles the repository's TypeScript source imports.
const { createOwnedNodeReporter } = await tsImport(new URL("../../src/verification/nodeReporter.ts",import.meta.url).href,import.meta.url) as typeof import("../../src/verification/nodeReporter");
const { allowedSelfTestFile, selfTestBlueprint } = await tsImport(new URL("shared.ts",import.meta.url).href,import.meta.url) as typeof import("./shared");
export default async function* (source: AsyncIterable<unknown>) {
  let selected: string | undefined;
  const prefix: unknown[] = [];
  const iterator = source[Symbol.asyncIterator]();
  for (;;) {
    const next = await iterator.next(); if (next.done) throw new Error("Trusted instrumentation source missing");
    prefix.push(next.value); if (prefix.length > 4096) throw new Error("Trusted instrumentation source limit");
    const event = next.value as { data?: { file?: unknown;entryFile?: unknown } };
    const file = event.data?.entryFile ?? event.data?.file;
    if (allowedSelfTestFile(file)) { selected = file; break; }
  }
  const events = (async function* () { for (const event of prefix) yield event;
    for (;;) { const next = await iterator.next(); if (next.done) break; yield next.value; } })();
  yield* createOwnedNodeReporter(selfTestBlueprint(selected))(events);
}
