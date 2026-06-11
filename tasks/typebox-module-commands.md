---
status: in-progress
size: medium
branch: typebox-module-commands
base: typebox-vendor
---

# Experiment: derive a CLI from plain TypeScript functions via vendored TypeBox

## Status Summary

Implementation in progress. Design probes done against the vendored `Type.Script` (see notes at the bottom); now building `src/module-commands.ts` (extractor + router builder) and the `createCli({module})` branch.

## Goal

Let users write a plain TypeScript module of exported functions and get a CLI, with no schema library and no router:

```ts
// commands.ts
/** install dependencies from the lockfile */
export async function install(options: {frozenLockfile?: boolean}) {
  // do install stuff here
}

export async function add(options: {
  /** the name of the thing to add */
  name: string
}) {
  return {somethingorother: 123}
}
```

```ts
// cli.ts
import {createCli} from 'trpc-cli'

void createCli({module: './commands.ts'}).run()
```

trpc-cli reads the module's **source text**, finds exported functions, feeds each function's options-parameter type literal to the vendored `Type.Script(...)` (which handles jsdoc → `description`), and builds a norpc router from the live exports. Function jsdoc becomes the command description; parameter property jsdoc becomes flag descriptions.

This is an experiment — mark the API `experimental_` or document it as experimental, per judgement.

## Design sketch (decisions for the implementer, deviate with recorded reasoning)

- **Two inputs needed**: runtime exports (to call) and source text (to extract types — runtime functions carry no type info). Resolution options, in preference order:
  1. `createCli({module: './commands.ts'})` — path resolved against `process.cwd()`; trpc-cli reads the file and dynamically imports it. Dynamic `.ts` import works when running under tsx/bun/deno/node>=23-strip-types, which is exactly the audience for this feature.
  2. Escape hatch for bundlers/browsers: `createCli({module: {source: '...', exports: await import('./commands.ts')}})` so neither `fs` nor dynamic import is required.
- **Browser-safety**: the main `trpc-cli` entrypoint must keep passing the bun browser-target build in `test_tgz`. `fs`/`import()` usage must be lazy/guarded (or live in a separate entrypoint like `trpc-cli/module` if that proves cleaner — decide and note why).
- **Source parsing**: a lightweight extractor, not the TypeScript compiler API (no new dependencies). It needs to find: `export function name(...)` / `export async function name(...)` / `export const name = (...) => ...` (arrow support optional — document), the first parameter's inline object-literal type annotation text, and the jsdoc immediately preceding the export. The heavy lifting (the type-literal-to-JSON-schema part, including nested jsdoc) is delegated to the vendored `Type.Script`, so the extractor only needs to slice out balanced `{...}` type-literal text — track brace depth, skip strings/comments.
- **Named/referenced types** (`export function f(opts: Options)` where `type Options = {...}` is declared in the module): nice-to-have. `Type.Script` can parse multi-declaration scripts; if cheap, pass the module's type declarations along as context. If not cheap, fail with a clear error telling the user to inline the type literal.
- **No parameter** → command with no args. **Non-object first param** (e.g. `name: string`) → out of scope for v1, error clearly.
- **Return values**: whatever the function returns gets logged the same way norpc procedure results are.
- **Validation**: input is validated by the schema produced from `Type.Script` (via its `~standard`), so typos in flags fail before the function runs.

## Checklist

- [ ] Source extractor: exported function declarations, jsdoc, first-param type literal text (balanced-brace slicing, string/comment-safe).
- [ ] Build norpc router from extracted commands: kebab-case command names from function names per existing trpc-cli conventions; function jsdoc → command description.
- [ ] `createCli({module: ...})` API accepting a path string and the `{source, exports}` escape hatch.
- [ ] Browser-target safety: bun build of the main entrypoint stays clean (no unconditional `fs`/`node:` imports).
- [ ] Tests: e2e — write a fixture commands module, run it through `createCli`, snapshot `--help` (descriptions from jsdoc visible) and invoke commands with flags; error cases (missing module, unparseable parameter, flag validation failure).
- [ ] README: short experimental section with the example above.
- [ ] `pnpm build`, `pnpm lint`, `pnpm test` green.

## Reference

- Base PR: #205 (`typebox-vendor`) — vendored `Type.Script` with jsdoc → description.
- `src/norpc.ts` — the router these commands compile down to.
- `src/bin.ts` — existing precedent for loading a user-supplied TS file (the `trpc-cli <file>` bin flow) — reuse its module-loading approach if applicable.

## Implementation notes

- 2026-06-11: Task created as the stacked half of the bedtime TypeBox work. The user's prompt sketched `createCli({module: './commands.ts'})` with inline-jsdoc'd destructured params; the destructured-with-inline-types syntax in the prompt was pseudocode — real TS requires a separate type annotation, which is what the extractor targets.
- 2026-06-11 (implementation): Probed the vendored `Type.Script` before writing code. Findings that shaped the design:
  - Multi-declaration scripts (`type A = {...}\ntype B = {...}`) return a *record* keyed by declaration name, cross-references resolve in either order, and `interface X extends Y {...}` works. But one unparseable declaration poisons the whole joined script (returns garbage like `{$ref: 'type'}`), so the builder parses the joined script first, validates every expected name came back, and falls back to iterative per-declaration parsing (passing the accumulated record as context, repeated to resolve chains) if not.
  - `Type.Script(context, expr)` resolves named refs from a context record - that's how `fn(opts: Options)` works without the TS compiler.
  - Unknown refs don't throw; they come back as `{$ref: 'TheName'}` embedded in the schema, so the builder walks the result for `$ref`s and errors with a "declare it in the same file or inline the literal" message.
  - Unparseable expressions also don't throw - they return `{not: {}}` (Never), which the builder detects and reports.
  - Known limitation (vendored jsdoc patch, not fixable here): a jsdoc comment on a *property* whose type is a named reference (`/** doc */ opts: AddOptions`) is dropped during instantiation. jsdoc on properties with inline types works fine.
- 2026-06-11 (decisions):
  - Async boundary: `createCli` stays sync. With `module`, the returned `TrpcCli`'s `run()` lazily (a) dynamic-imports `./module-commands.js`, (b) reads/imports the module, (c) builds the norpc router, then delegates to the regular `createCli({router, ...})`. `buildProgram`/`toJSON` throw a clear "not supported with module (experimental) - pass a router" error, since they're sync APIs and module resolution is inherently async. Recorded as an experimental limitation rather than making everything async.
  - Browser safety: no separate entrypoint needed. `node:fs/promises`/`node:path`/`node:url` are dynamic-imported inside the string-path branch only, and `./module-commands.js` itself is dynamic-imported from `createCli`, so the main entrypoint has no new unconditional `node:` imports (`util`/`node:stream` were already there). Verified with `bun build --target=browser`.
  - Command driver: extracted source declarations (in source order) are matched against runtime exports. Extracted-but-not-a-function exports are skipped silently (the extractor regexes can false-positive on e.g. `export const x = (2 + 3)`); function exports with no parseable declaration throw, listing the supported syntaxes. `default` exports are ignored (documented).
  - First-param slicing terminates at a top-level `,` or `=`; `<`/`>` are tracked as brackets except `=>`'s `>`. Multi-arg generic refs without braces (e.g. a bare `Record<string, number>` annotation) mis-slice and produce the unparseable-type error - acceptable for v1, the error names the offending text.
