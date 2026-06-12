---
status: in-progress
size: medium
branch: typebox-module-commands
base: typebox-vendor
---

# Experiment: derive a CLI from plain TypeScript functions via vendored TypeBox

## Status Summary

Implementation complete; build/lint/tests green locally and the bun browser-target bundle of the main entrypoint verified. Main pieces: `src/module-commands.ts` (source extractor + norpc router builder), the `createCli({module})` overload in `src/index.ts`, `TrpcCliModuleParams` in `src/types.ts`, e2e tests in `test/typebox-module-commands.test.ts` with a fixture at `test/fixtures/commands-module.ts`, and a README section. `module` now also accepts a `URL` (`new URL('./commands.ts', import.meta.url)`) so distributed CLIs aren't tied to `process.cwd()`. TS function overloads are now supported (first overload signature wins - see 2026-06-12 note). Known v1 limitations are documented (no `buildProgram`/`toJSON` in module mode, no `export {f}`/re-exports/default exports, no type-annotated consts, jsdoc dropped on properties typed by named refs). Two review rounds on PR #206 addressed; remaining minors recorded below as accepted limitations.

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

- [x] Source extractor: exported function declarations, jsdoc, first-param type literal text (balanced-brace slicing, string/comment-safe). _`extractModuleCommands` + `scanSource`/`findBalancedEnd`/`parseFirstParamType` in src/module-commands.ts. Handles `export function`/`export async function`/`export const f = (...) =>`, destructured params, optional markers, default values, and named type refs via `buildDeclarationContext`._
- [x] Build norpc router from extracted commands: kebab-case command names from function names per existing trpc-cli conventions; function jsdoc → command description. _`buildRouterFromModule`/`buildProcedure` in src/module-commands.ts - procedures keep the camelCase export name, the existing `kebabCase` in src/index.ts does the rest. jsdoc → `meta.description`._
- [x] `createCli({module: ...})` API accepting a path string and the `{source, exports}` escape hatch. _Overload on `createCli` in src/index.ts; `TrpcCliModuleParams` in src/types.ts. `run()` lazily dynamic-imports module-commands.js; `buildProgram`/`toJSON` throw a clear experimental-limitation error._
- [x] Browser-target safety: bun build of the main entrypoint stays clean (no unconditional `fs`/`node:` imports). _`node:fs/promises`/`node:path`/`node:url` only dynamic-imported inside the path-string branch; verified `bun build` (browser target) of a CLI importing dist/index.js exits 0._
- [x] Tests: e2e — write a fixture commands module, run it through `createCli`, snapshot `--help` (descriptions from jsdoc visible) and invoke commands with flags; error cases (missing module, unparseable parameter, flag validation failure). _test/typebox-module-commands.test.ts (12 tests) + test/fixtures/commands-module.ts. Also verified manually under tsx and plain node 26 (native strip-types imports the .ts fixture)._
- [x] README: short experimental section with the example above. _"CLI from a plain TypeScript module — Experimental" section after the typebox validator section; `createCli` API-docs codegen block regenerated with the new `module` param._
- [x] `pnpm build`, `pnpm lint`, `pnpm test` green. _All exit 0 locally after merging origin/typebox-vendor (which fixed the tsc OOM)._

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
- 2026-06-11 (wrap-up):
  - Test harness tweak: `test/test-run.ts` now JSON-stringifies object results on the success path (was `String(e.cause)` → `[object Object]`), mirroring what the default line-by-line logger does for users. No existing snapshots relied on the old behavior. Also widened `runWith` to accept `TrpcCliModuleParams`.
  - Deliberately deferred follow-ups: `buildProgram`/`toJSON` support in module mode (would need an async variant or eager loading); `export {f}`/`export default` declarations; positional arguments (a `positional` marker has no jsdoc-comment syntax yet - everything is a flag); generic command functions with function-type constraints; multi-parameter functions (extra params are just `undefined` at call time); the named-ref-property jsdoc drop (needs a fix in the vendored jsdoc patch, owned by the typebox-vendor branch).
  - `bun build` browser-target bundle of the main entrypoint grows to ~3.9MB because the dynamic `import('./module-commands.js')` (and through it the vendored typebox parser) gets inlined by bundlers. It still builds and runs fine; if size matters later, the feature could move to a `trpc-cli/module` entrypoint.
- 2026-06-11 (review follow-ups, from the subagent review on PR #206):
  - Fixed the one major finding: `type X = {...} & {...}`/multi-line union aliases were sliced at the first balanced `}`, silently dropping the tail. Type aliases are now sliced with `findTypeAliasEnd` (statement-aware: depth-0 `;`, or depth-0 newline with no adjacent `=`/`|`/`&` continuation). Object-only intersections (`allOf`) are flattened into a single object schema for flag derivation, validating against the original intersection via a re-attached `~standard`.
  - `findBalancedEnd` got the `=>` exception (generics like `<T extends () => void>` no longer mis-close).
  - `jsdocBefore` now skips intervening line/block comments (e.g. `// eslint-disable-next-line` between jsdoc and declaration); `scanSource` records line comments for that purpose.
  - README: user-controlled-path warning + bundle-size note + intersection support documented.
  - Left as-is from the review (minor/nit, experimental feature): annotated consts (`export const f: Cmd = ...`), unparenthesized arrow params, TS overload-signature duplicate extraction, `extends Y<{...}>` interface regex mis-slice, index-only unbalanced-bracket error message.
- 2026-06-11 (second review round, PR #206):
  - Finding 1 (CI red - tsc error after the typebox-vendor merge tightened `~standard` types): fixed in d2dae15 (cast via `unknown` at the `~standard` re-attach).
  - Finding 2 (cwd-relative module resolution footgun): `module` now accepts a `URL` instance - `createCli({module: new URL('./commands.ts', import.meta.url)})` resolves against the importing file via `fileURLToPath` (still inside the lazily-imported `node:` branch, so browser-safety holds). The string form stays cwd-relative for quick scripts. README leads with the URL form; tests cover the URL form in-process and e2e from `os.tmpdir()` via a new fixture CLI (`test/fixtures/commands-module-cli.ts`).
  - Finding 3 (re-exports throw vs README's "not picked up"): decided to KEEP the loud throw. Reasoning: a runtime function export with no parseable declaration is ambiguous - it might be a helper (harmless to skip) or a real command the user expects to exist (silently dropping it would be the feature lying, the exact failure mode the first review dinged). Failing at startup with a message naming the export and telling the user to move non-command exports out is recoverable in seconds; a skipped command might not be noticed until a user hits it. README now states the constraint plainly (module must export only commands; helpers must not be re-exported; default exports are ignored), the unparseable-declaration error suggests moving non-command exports to a separate module, and the "No commands found" error mentions that default exports are ignored. Both error paths are tested.
  - Findings 4 (overload duplicate extraction) and the item-5 minors stand as accepted limitations per the earlier round (recorded above).
- 2026-06-12 (overloads + const-arrow coverage): finding 4 is no longer an accepted limitation - TS function overloads are now supported.
  - Semantics: each overload declaration extracts separately; `extractModuleCommands` now dedupes to one command per export name, preferring the first body-less *signature* over the *implementation* (whose params are typically widened to `any` - previously the implementation won via last-write and produced a misleading "type `any` can't be a positional" error). Rationale: TS resolves calls against overload signatures in order, so the first signature is the primary documented shape, and a CLI can only present one calling convention. Later overloads are ignored (tested: `--mode b` from a second overload is rejected, pinning the documented behavior).
  - Considered and deferred: a union of all overload signatures as the schema. Rejected because the flattened flag set would advertise combinations no single overload accepts, and the runtime spread couldn't tell which signature the user meant.
  - Body detection: new `hasFunctionBody` scans past an optional return-type annotation with bracket-depth tracking; a depth-0 `{` is the body unless it sits where a type literal can start (after `:`/`|`/`&`/`?`/`=>`). Verified against object-literal return types, `Promise<...>` returns before a body, and function-type returns (`(): () => {y: number} {`). Params are parsed only for the winning declaration, so an unannotated implementation can't poison a command whose signatures are fine.
  - Const-arrow coverage (verified, already worked - tests added to pin): `export const install = async (params: {name: string; ...}) => {...}` (the `async` between `=` and `(` was already handled by the extraction regex) and the destructured variant `export const install = async ({name, dev, exact}: {...}) => {...}` (destructuring is only rejected in positional positions). Type-annotated consts (`export const f: Cmd = ...`) remain unsupported - test pins the existing "Could not find a parseable declaration" error.
  - README updated (overload rule + const-arrow/annotated-const notes); PR #206 deferred-follow-ups list updated to drop overloads.
