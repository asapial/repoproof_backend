# Static owned-fixture admission — RPF-ADMIT-001

`admitDiscount` parses bytes only. It never imports or evaluates the supplied
program. ADMISSIBLE is a static policy decision, not an execution result,
isolation assertion, or verification verdict. Public execution remains disabled.

The production parser and AST definitions are pinned to `@babel/parser` and
`@babel/types` 8.0.10, with registry integrity entries in package-lock.json.
Their Node requirement (`^22.18.0 || >=24.11.0`) supports the project's Node 24
runtime. Official references: [parser API](https://babeljs.io/docs/babel-parser)
and [AST node definitions](https://babeljs.io/docs/babel-types), checked November
2, 2026. Parsing uses strict ES modules, no error recovery, explicit parenthesis
and import nodes, and only the TypeScript plugin when requested. No Babel
transforms, config discovery, plugins from disk, traversal hooks, or evaluation.

## Versioned grammar

Policy `rpf-discount-ast-v1` supports only this owned discount fixture:

- Source: one named export `applyDiscount(price, percentage)`, synchronous and
  non-generator, optional primitive `number` annotations, numeric `const` values,
  and one final numeric return. Finite numeric literals, known numeric bindings,
  parentheses, unary plus/minus, arithmetic `+ - * / %`, numeric comparisons,
  boolean operations and conditionals are allowed. Every conditional branch is
  checked. There are no calls, member reads, writes, loops or closures in source.
- Tests: three exact imports (`{ test }` from `node:test`, default `assert` from
  `node:assert/strict`, `{ applyDiscount }` from `../src/discount.mjs`). Imports
  precede registration. No unauthorized modules, type-only imports, namespaces,
  import attributes, callable aliases or renamed imports.
- Exactly one issue test; one to sixteen regression tests. Each registration is
  `test(nonemptyUniqueTitle, () => { ... })` with no options or parameters. Each
  body contains numeric constants and at least one unconditional direct
  `assert.equal` or `assert.strictEqual`. Actual must directly call
  `applyDiscount` with two numeric expressions; expected is a numeric expression.
  Assertion descriptions do not count as assertions. Numeric expressions cannot
  invoke code or access properties. Semantic correctness still requires genuine
  independently observed baseline and patched execution.

Everything else is rejected, including focused/skipped/todo/disabled/empty tests,
context hooks, async, early return, conditional assertions, swallowed failures,
destructuring, getters, spread, eval, Function, dynamic imports, globals,
unknown identifiers, computed/optional/prototype/constructor property paths,
function aliases, recursive calls, TS assertions/enums/namespaces and JSX.
Escaped identifiers are rejected, including escaped property names. Primitive
TypeScript annotations are syntax support only; no TypeScript is executed or
transpiled. Existing `.mjs` fixture bytes remain unchanged.

Fatal UTF-8 decoding, byte bounds (16,000 source / 24,000 test), 48 expression
depth and 2,048 expression-node limits fail closed. Parser errors and unknown AST
types produce fixed reason codes without logging supplied source or errors.
Accepted reports bind SHA-256 of the original bytes, never a printed AST.
No static report is a transferable execution authorization or trust credential.

Tests read the pinned manifest and source files as data. Adversarial programs are
inert strings tested against the validator; none is imported, compiled, run in a
VM, or executed by the host test framework. Full quality, security audit and
fixture integrity evidence is recorded in the canonical board and local ledger.
RPF-004 stays IN_PROGRESS; RPF-006A stays DEFERRED; RPF-005/006B are unchanged.
