---
status: in-progress
size: medium
branch: typebox-module-positionals
base: typebox-module-commands
---

# Module commands: multi-parameter functions become positional arguments

## Status Summary

Spec written, implementation starting. Stacked on #206 (`createCli({module})`), which is stacked on #205 (vendored typebox). Goal: leading scalar parameters of exported functions map to CLI positional arguments; a trailing object-literal parameter maps to flags, mirroring trpc-cli's existing tuple-input convention.

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

- [ ] Extractor: parse the full parameter list (name, optional `?`/default, type annotation text, inline jsdoc per param) instead of just the first param.
- [ ] Clear errors for unsupported shapes: rest params, destructured params (outside the final-object position), object param in non-final position, missing annotations, optional array params.
- [ ] Tuple synthesis + runtime spread: `[t1, t2, {...}]` script via `Type.Script`, items mutated with titles/descriptions/minItems, handler calls `fn(...input)`.
- [ ] Fixture + tests: help snapshots, execution (including omitted optionals and defaults), validation failures, error cases.
- [ ] `pnpm build`, `pnpm lint`, vitest all green.
- [ ] README: extend the module-commands section with a positionals example.

## Implementation notes

- 2026-06-11: Task created as a scoped follow-up to #206. Probed Type.Script tuple support first (findings above) - the `[number, number?]` optionality drop means the `| undefined` synthesis route, not tuple `?` syntax. Also confirmed: omitted optional positionals arrive as `undefined` slots in `positionalValues` (commander passes one arg per declared Argument), so the synthesized union schemas validate exactly what the runtime produces.
- 2026-06-11: A quirk worth knowing: importing src/typebox directly under the tsx loader hit `S.AddOptionalDeferred is not a function` (circular-import initialization artifact under tsx's CJS path); the compiled dist and vitest are unaffected. Not caused by - and not fixable in - this branch; noted for anyone probing src/typebox with tsx directly.
