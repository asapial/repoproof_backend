import { createHash } from "node:crypto";
import { parse } from "@babel/parser";
import type * as t from "@babel/types";

export const admissibilityVersion = "rpf-discount-ast-v1" as const;
export type Admission = Readonly<
  { status: "ADMISSIBLE"; policy: typeof admissibilityVersion; sha256: string; tests: number; assertions: number } |
  { status: "REJECTED"; policy: typeof admissibilityVersion; reason: "INVALID_BYTES" | "SYNTAX" | "UNSUPPORTED" }
>;
export type Syntax = "javascript" | "typescript";
type Primitive = "number" | "boolean";
type Scope = Map<string, Primitive>;

class Unsupported extends Error {}
function requireAllowed(condition: unknown): asserts condition {
  if (!condition) throw new Unsupported();
}

// The grammar is deliberately smaller than JavaScript. No generic AST fallback
// or visitor can silently admit a new node type after a parser upgrade.
class Grammar {
  #nodes = 0;
  constructor(private readonly text: string) {}
  enter(depth: number) { requireAllowed(++this.#nodes <= 2048 && depth <= 48); }
  identifier(node: t.Node | null | undefined, name?: string): node is t.Identifier {
    return !!node && node.type === "Identifier" && /^[A-Za-z][A-Za-z0-9]*$/.test(node.name) &&
      this.text.slice(node.start!, node.start! + node.name.length) === node.name && (name === undefined || node.name === name) &&
      !node.optional && !node.decorators?.length;
  }
  numberType(node: t.TypeAnnotation | t.TSTypeAnnotation | null | undefined) {
    requireAllowed(!node || (node.type === "TSTypeAnnotation" && node.typeAnnotation.type === "TSNumberKeyword"));
  }
  expression(node: t.Node | null | undefined, scope: Scope, depth = 0): Primitive {
    this.enter(depth);
    requireAllowed(node);
    switch (node.type) {
      case "NumericLiteral": requireAllowed(Number.isFinite(node.value)); return "number";
      case "BooleanLiteral": return "boolean";
      case "Identifier": {
        requireAllowed(this.identifier(node) && !node.typeAnnotation && scope.has(node.name));
        return scope.get(node.name)!;
      }
      case "ParenthesizedExpression": return this.expression(node.expression, scope, depth + 1);
      case "UnaryExpression": {
        const kind = this.expression(node.argument, scope, depth + 1);
        requireAllowed(node.prefix && ((["+", "-"].includes(node.operator) && kind === "number") || (node.operator === "!" && kind === "boolean")));
        return node.operator === "!" ? "boolean" : "number";
      }
      case "BinaryExpression": {
        requireAllowed(this.expression(node.left, scope, depth + 1) === "number" && this.expression(node.right, scope, depth + 1) === "number");
        if (["+", "-", "*", "/", "%"].includes(node.operator)) return "number";
        requireAllowed(["===", "!==", "<", "<=", ">", ">="].includes(node.operator));
        return "boolean";
      }
      case "LogicalExpression":
        requireAllowed(["&&", "||"].includes(node.operator) && this.expression(node.left, scope, depth + 1) === "boolean" && this.expression(node.right, scope, depth + 1) === "boolean");
        return "boolean";
      case "ConditionalExpression": {
        requireAllowed(this.expression(node.test, scope, depth + 1) === "boolean");
        const kind = this.expression(node.consequent, scope, depth + 1);
        requireAllowed(this.expression(node.alternate, scope, depth + 1) === kind);
        return kind;
      }
      default: throw new Unsupported();
    }
  }
  constant(node: t.VariableDeclaration, scope: Scope) {
    requireAllowed(node.kind === "const" && node.declarations.length === 1 && !node.declare);
    const declaration = node.declarations[0]!;
    requireAllowed(this.identifier(declaration.id) && !scope.has(declaration.id.name) &&
      !["test", "assert", "applyDiscount", "eval", "Function", "globalThis", "process", "constructor", "prototype"].includes(declaration.id.name));
    this.numberType(declaration.id.typeAnnotation);
    requireAllowed(this.expression(declaration.init, scope) === "number");
    scope.set(declaration.id.name, "number");
  }
  source(program: t.Program) {
    requireAllowed(program.body.length === 1);
    const exported = program.body[0]!;
    requireAllowed(exported.type === "ExportNamedDeclaration" && exported.specifiers.length === 0 && !exported.source &&
      exported.exportKind !== "type" && exported.declaration?.type === "FunctionDeclaration");
    const fn = exported.declaration;
    requireAllowed(this.identifier(fn.id, "applyDiscount") && !fn.async && !fn.generator && !fn.declare && !fn.typeParameters &&
      !fn.predicate && fn.params.length === 2 && fn.body.directives.length === 0);
    this.numberType(fn.returnType);
    const scope: Scope = new Map();
    for (const [index, name] of ["price", "percentage"].entries()) {
      const parameter = fn.params[index]!;
      requireAllowed(this.identifier(parameter, name));
      this.numberType(parameter.typeAnnotation);
      scope.set(name, "number");
    }
    requireAllowed(fn.body.body.length > 0 && fn.body.body.length <= 32);
    for (const [index, statement] of fn.body.body.entries()) {
      if (statement.type === "VariableDeclaration") {
        requireAllowed(index < fn.body.body.length - 1);
        this.constant(statement, scope);
      } else {
        requireAllowed(index === fn.body.body.length - 1 && statement.type === "ReturnStatement" && this.expression(statement.argument, scope) === "number");
      }
    }
    requireAllowed(fn.body.body.at(-1)?.type === "ReturnStatement");
  }
  testImport(node: t.ImportDeclaration): string {
    requireAllowed(node.importKind !== "type" && !node.attributes?.length &&
      !node.phase && node.specifiers.length === 1);
    const specifier = node.specifiers[0]!;
    const source = node.source.value;
    if (source === "node:assert/strict") {
      requireAllowed(specifier.type === "ImportDefaultSpecifier" && this.identifier(specifier.local, "assert"));
    } else {
      const name = source === "node:test" ? "test" : source === "../src/discount.mjs" ? "applyDiscount" : null;
      requireAllowed(name && specifier.type === "ImportSpecifier" && specifier.importKind !== "type" &&
        this.identifier(specifier.imported, name) && this.identifier(specifier.local, name));
    }
    return source;
  }
  tests(program: t.Program, role: "issue" | "regressions") {
    const imports = new Set<string>(), titles = new Set<string>();
    let tests = 0, assertions = 0;
    for (const statement of program.body) {
      if (statement.type === "ImportDeclaration") {
        requireAllowed(tests === 0);
        const source = this.testImport(statement);
        requireAllowed(!imports.has(source)); imports.add(source);
        continue;
      }
      requireAllowed(imports.size === 3 && statement.type === "ExpressionStatement" && statement.expression.type === "CallExpression");
      const call = statement.expression;
      requireAllowed(this.identifier(call.callee, "test") && call.arguments.length === 2 && !call.typeArguments);
      const [title, callback] = call.arguments;
      requireAllowed(title?.type === "StringLiteral" && title.value.trim().length > 0 && title.value.length <= 200 &&
        !/[\x00-\x1f\x7f]/.test(title.value) && !titles.has(title.value));
      titles.add(title.value);
      requireAllowed(callback?.type === "ArrowFunctionExpression" && !callback.async && !callback.generator && callback.params.length === 0 &&
        !callback.typeParameters && !callback.returnType && !callback.predicate && callback.body.type === "BlockStatement" && callback.body.directives.length === 0);
      const scope: Scope = new Map();
      let count = 0;
      requireAllowed(callback.body.body.length > 0 && callback.body.body.length <= 32);
      for (const body of callback.body.body) {
        if (body.type === "VariableDeclaration") { this.constant(body, scope); continue; }
        requireAllowed(body.type === "ExpressionStatement" && body.expression.type === "CallExpression");
        const assertion = body.expression;
        requireAllowed(assertion.callee.type === "MemberExpression" && !assertion.callee.computed &&
          this.identifier(assertion.callee.object, "assert") && this.identifier(assertion.callee.property) &&
          ["equal", "strictEqual"].includes(assertion.callee.property.name) && assertion.arguments.length === 2 &&
          !assertion.typeArguments);
        const [actual, expected] = assertion.arguments;
        requireAllowed(actual?.type === "CallExpression" && this.identifier(actual.callee, "applyDiscount") &&
          actual.arguments.length === 2 && !actual.typeArguments);
        for (const argument of actual.arguments) requireAllowed(this.expression(argument, scope) === "number");
        requireAllowed(this.expression(expected, scope) === "number");
        count++;
      }
      requireAllowed(count > 0);
      tests++; assertions += count;
    }
    requireAllowed(tests > 0 && tests <= (role === "issue" ? 1 : 16));
    return { tests, assertions };
  }
}

/** Static acceptance only: never evaluates source, establishes isolation, or issues a verdict. */
export function admitDiscount(bytes: Uint8Array, role: "source" | "issue" | "regressions", syntax: Syntax = "javascript"): Admission {
  const reject = (reason: "INVALID_BYTES" | "SYNTAX" | "UNSUPPORTED"): Admission => Object.freeze({ status: "REJECTED", policy: admissibilityVersion, reason });
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > (role === "source" ? 16000 : 24000)) return reject("INVALID_BYTES");
  let text: string;
  const copy = Buffer.from(bytes);
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy);
    if (text.includes("\0") || text.startsWith("\uFEFF")) return reject("INVALID_BYTES");
  } catch { return reject("INVALID_BYTES"); }
  if (!["javascript", "typescript"].includes(syntax) || !["source", "issue", "regressions"].includes(role)) return reject("UNSUPPORTED");
  let program: t.Program;
  try {
    const file = parse(text, { sourceType: "module", strictMode: true, errorRecovery: false, annexB: false,
      createImportExpressions: true, createParenthesizedExpressions: true, attachComment: false,
      plugins: syntax === "typescript" ? ["typescript"] : [] });
    if (file.errors?.length) return reject("SYNTAX");
    program = file.program;
  } catch { return reject("SYNTAX"); }
  try {
    requireAllowed(!program.interpreter && program.directives.length === 0);
    const grammar = new Grammar(text);
    const counts = role === "source" ? (grammar.source(program), { tests: 0, assertions: 0 }) : grammar.tests(program, role);
    return Object.freeze({ status: "ADMISSIBLE", policy: admissibilityVersion, sha256: createHash("sha256").update(copy).digest("hex"), ...counts });
  } catch { return reject("UNSUPPORTED"); }
}
