---
status: ready-for-review
size: medium
branch: typebox-module-positionals
base: typebox-module-commands
---

# Module commands: multi-parameter functions become positional arguments

## Status Summary

Implementation complete; build/lint/tests green locally (356 tests). Stacked on #206 (`createCli({module})`), which is stacked on #205 (vendored typebox). PR: #207. Main pieces: full-parameter-list extractor (`parseParams`) + tuple-script synthesis (`buildPositionalProcedure`) in src/module-commands.ts, a one-line positional type-display fix in src/parse-procedure.ts, `kebabCase` moved to src/util.ts (re-exported from index), new fixture test/fixtures/positional-commands-module.ts + 11 new tests, README section extended. Nothing known missing; deferred items listed at the bottom.

## Goal

PR #206 deliberately errored on non-object first params and ignored extra params. This makes multi-parameter functions work the obvious way:

```ts
// commands.ts
/** add two numbers */
export async function add(left: number, right: number) {
  return left + right
}
/** copy a file */
export async function copy(source: string, dest?: string, options?: {force?: boolean}) {
  // ...
}
```

→ `mycli add 2 3` prints 5; `mycli copy a.txt b.txt --force` works; `mycli copy a.txt` works (optional positional omitted).

This mirrors the existing tuple-input convention: `(a: number, b: string, opts: {...})` produces the same CLI as a procedure with `.input(Type.Script('[number, string, {...}]'))`. The implementation synthesizes exactly that tuple script from the extracted parameter list and lets the existing tuple handling (`parseTupleInput` in src/parse-procedure.ts) do the work. The runtime handler spreads the validated tuple back into the function call: `fn(...input)`.

## Design decisions (probed against the vendored Type.Script before implementation)

- **Optional tuple elements**: `Type.Script('[number, number?]')` parses but *silently drops* the optionality (`minItems` stays at the full length and the item schema rejects `undefined`). Labeled tuple elements (`[left: number]`) parse but drop the labels too. So instead of relying on tuple `?`, optional scalar params are synthesized as `(T) | undefined` union elements — the vendored validator accepts `undefined` for those, and trpc-cli's existing `isOptional`/`hasUndefinedType` logic in parse-procedure.ts already treats `{type: 'undefined'}` union members as optional (it's the documented typebox convention there).
- **Positional names/descriptions**: the `~standard` validator reads the schema object *live*, so after parsing the synthesized tuple script we mutate `items[i]` in place: `title` = kebab-cased param name (drives `<left>`/`[right]` display via `parameterName`), `description` = inline param jsdoc (`/** doc */ left: number`) when present. `minItems` is fixed up to the required-prefix length.
- **Default values** (`right = 3`): treated as optional-for-CLI. When omitted, the validated tuple slot is `undefined` and JS parameter defaults kick in naturally at call time. A default *without* a type annotation (`right = 3` alone) errors — we don't infer types from literals.
- **Optional params followed by required ones** (`(a = 1, b: number)` — legal TS): positionally you can't skip `a` anyway, so only the *trailing run* of optional params becomes CLI-optional; earlier optionals are treated as required.
- **Optional trailing object param** (`options?: {...}`): treated the same as required — trpc-cli always passes the flags object (possibly empty), which is compatible with a parameter that allows `undefined`.
- **Single-param functions**: object-literal first param keeps the exact v1 behavior (flags only, `fn(input)`); a single *scalar* param now becomes one positional via the tuple path instead of erroring.
- **Arrays**: a required `files: string[]` param flows through as a variadic positional (existing tuple machinery supports it). An *optional* array param errors clearly — the `| undefined` wrapping would defeat `looksLikeArray` and silently degrade to JSON input.
- **Type display**: `parseTupleInput` in src/parse-procedure.ts now filters `undefined` out of the positional type display (so help shows `number`, not `number | undefined` — optionality is already conveyed by `[name]` vs `<name>`), which also lets the existing number-argParser nicety kick in for optional number positionals.

## Checklist

- [x] Extractor: parse the full parameter list (name, optional `?`/default, type annotation text, inline jsdoc per param) instead of just the first param. _`parseParams` in src/module-commands.ts replaces `parseFirstParamType`; `ExtractedCommand.paramType` became `params: ExtractedParam[]`. Reuses the existing `scanSource` comment/string mask and bracket-depth tracking; segments split at top-level commas._
- [x] Clear errors for unsupported shapes: rest params, destructured params (outside the final-object position), object param in non-final position, missing annotations, optional array params. _Thrown from `parseParams`/`buildPositionalProcedure` with the function and parameter named; each has a test using the `{source, exports}` escape hatch._
- [x] Tuple synthesis + runtime spread: `[t1, t2, {...}]` script via `Type.Script`, items mutated with titles/descriptions/minItems, handler calls `fn(...input)`. _`buildPositionalProcedure` in src/module-commands.ts. Per-param schemas are parsed individually first (objectness checks + param-named errors), then the joined tuple script is parsed once for the real validating schema._
- [x] Fixture + tests: help snapshots, execution (including omitted optionals and defaults), validation failures, error cases. _test/fixtures/positional-commands-module.ts + 11 new tests in test/typebox-module-commands.test.ts; two v1 tests updated (single scalar param now works instead of erroring; param-named annotation/ref error messages)._
- [x] `pnpm build`, `pnpm lint`, vitest all green. _All exit 0 locally; full suite 356 passed._
- [x] README: extend the module-commands section with a positionals example. _Same section, `add`/`copy` example + updated limitations list._

## Implementation notes

- 2026-06-11: Task created as a scoped follow-up to #206. Probed Type.Script tuple support first (findings above) - the `[number, number?]` optionality drop means the `| undefined` synthesis route, not tuple `?` syntax. Also confirmed: omitted optional positionals arrive as `undefined` slots in `positionalValues` (commander passes one arg per declared Argument), so the synthesized union schemas validate exactly what the runtime produces.
- 2026-06-11: A quirk worth knowing: importing src/typebox directly under the tsx loader hit `S.AddOptionalDeferred is not a function` (circular-import initialization artifact under tsx's CJS path); the compiled dist and vitest are unaffected. Not caused by - and not fixable in - this branch; noted for anyone probing src/typebox with tsx directly.
- 2026-06-11 (wrap-up):
  - The v1 single-object-param path is preserved exactly (same schema, same `fn(input)` call), so #206's snapshots didn't change. Single *scalar* param functions now go through the tuple path and get one positional instead of the v1 "must be an object type" error.
  - `kebabCase` moved from src/index.ts to src/util.ts (index re-exports it, public API unchanged) so module-commands can kebab-case positional names without importing the whole entrypoint.
  - Filtering `undefined` out of the positional type display in `parseTupleInput` had a pleasant side effect: optional number positionals now hit the `param.type === 'number'` check in index.ts, so `mycli add 2 banana` fails fast with commander's "Invalid number: banana" instead of a later schema error.
  - Booleans work as positionals (`true`/`false` strings via the existing `convertPositional`); literal unions (`'fast' | 'slow'`, inline or via a named `type Mode = ...`) work too (`getSchemaTypes` counts their consts as primitives).
  - Deferred: rest params as variadic positionals (the tuple machinery could support `...files: string[]` as a trailing array element - erroring for now per scope); optional array params (the `| undefined` wrapping would defeat `looksLikeArray` and silently degrade to JSON input, so they error); native labeled/optional tuple-element support in the vendored Type.Script (would make `?` and labels work without synthesis - owned by the typebox-vendor branch).
- 2026-06-11 (review follow-ups, from the subagent review on PR #207):
  - Fixed the major finding: the flags-object decision used the strict `isObjectSchema` everywhere, regressing the base branch's support for union-of-objects params (`opts: {a} | {b}` → union flags). `isObjectLikeSchema` (objects + anyOf-of-objects) now drives the single-param path, `lastIsFlagsObject`, and the only-last-param-can-be-an-object error; regression test added.
  - Tests added per review: trailing intersection-alias options object in a multi-param function (pins the tuple-level mergeIntersection), boolean + literal-union positionals, destructured trailing options object.
  - Error-message fixes: removed the false "a variadic positional can already receive zero values" parenthetical (required variadics need ≥1 value); the rest-param suggestion now echoes the actual annotation (`numbers: number[]`, not always `string[]`).
- 2026-06-11 (CI fix): the bun-compiled test_tgz binary crashed with `__promiseAll is not defined` - the new `module-commands.ts → json-schema.ts` import edge shared json-schema.ts's top-level `await Promise.all` between the entry and dynamic chunks, a shape where bun's bundler drops its helper definition. `getSchemaTypes` (pure) moved to `util.ts`, re-exported from json-schema.ts. Verified bidirectionally with a local `bun build --compile` repro. All checks green.
