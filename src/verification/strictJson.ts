import { parseExpression } from "@babel/parser";
import type { Node } from "@babel/types";

/** Standard JSON plus duplicate/prototype-key and structural resource rejection. */
export function readStrictJson(bytes: Uint8Array, limit: number): unknown {
  try {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1048576 || !(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > limit) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    // JSON.parse first enforces JSON syntax. Babel inspects decoded object keys
    // without evaluation, including escaped duplicate spellings JSON.parse loses.
    const expression = parseExpression(text, { sourceType: "module", errorRecovery: false, plugins: [] });
    let nodes = 0;
    const visit = (node: Node, depth: number) => {
      if (++nodes > 32768 || depth > 64) throw new Error();
      if (node.type === "NumericLiteral") { if (!Number.isFinite(node.value)) throw new Error(); return; }
      if (["StringLiteral", "BooleanLiteral", "NullLiteral"].includes(node.type)) return;
      if (node.type === "ArrayExpression") {
        for (const item of node.elements) { if (!item || item.type === "SpreadElement") throw new Error(); visit(item, depth + 1); }
      } else if (node.type === "ObjectExpression") {
        const keys = new Set<string>();
        for (const property of node.properties) {
          if (property.type !== "ObjectProperty" || property.computed || property.shorthand || property.key.type !== "StringLiteral" ||
            keys.has(property.key.value) || ["__proto__", "constructor", "prototype"].includes(property.key.value)) throw new Error();
          keys.add(property.key.value); visit(property.value, depth + 1);
        }
      } else if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral") {
        visit(node.argument, depth + 1);
      } else throw new Error();
    };
    visit(expression, 0); return value;
  } catch { throw new Error("INVALID_JSON"); }
}
