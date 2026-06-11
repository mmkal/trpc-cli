---
status: in-progress
size: large
branch: typebox-vendor
---

# Vendor TypeBox: `trpc-cli/typebox` with jsdoc descriptions + standard-schema

## Status Summary

Done, pending review + CI. Vendored source + jsdoc patch + `trpc-cli/typebox` wrapper + restored Standard JSON Schema detection + tests + README all in. The tsc OOM was root-caused (any required `~standard` member on the base `TSchema` interface poisons every structural relation in the 700-file vendored source) and fixed by declaring it on the ~20 concrete schema interfaces instead — compile is back to baseline speed (~6s, ~1.2GB peak) and the temporary heap bump was reverted. Verified locally: build/lint/tests green, attw esm-only on packed tarball, deep-import + zero-dep runtime smoke from a clean install, bun build/compile/run. This is the "broader rethink" promised when PR #202 was closed.

## Goal

TypeBox as a first-class, **zero-peer-dependency** way to define trpc-cli inputs. Vendor typebox into trpc-cli so users get this out of the box:

```ts
import Type from 'trpc-cli/typebox'

const Input = Type.Script(`{
  /** a message to say hello to new users */
  greeting: string
}`)
```

...where `Input` is a plain TypeBox JSON Schema object, **but**:

1. it has a `~standard` prop (StandardSchemaV1, including `~standard.jsonSchema` per [Standard JSON Schema](https://standardschema.dev/json-schema)), so trpc/orpc/norpc/trpc-cli accept it directly with no wrapper, and
2. `Type.Script` parses jsdoc comments on properties into JSON Schema `description` fields.

Combined with norpc (`src/norpc.ts`, the built-in dependency-free router), this gives fully peer-dependency-free trpc-cli usage: no zod, no @trpc/server, no @orpc/server.

## Why vendor (context from upstream discussions)

- **`~standard`**: upstream won't implement it natively — schemas-shouldn't-validate-themselves principle. Their answer is the `example/standard` reference adapter and TypeMap. See https://github.com/sinclairzx81/typebox/discussions/1152 (mmkal ⇄ sinclairzx81, May 2026). Since we vendor, we bake `~standard` onto schemas returned by our export surface instead of requiring a wrapper like the old `typeboxToStandardSchema` from PR #201.
- **jsdoc → description**: upstream treats comments as whitespace in the Script parser for performance, and won't add jsdoc parsing before TB 2.x. See https://github.com/sinclairzx81/typebox/issues/1597. mmkal's fork branch demonstrates a working runtime implementation: https://github.com/sinclairzx81/typebox/compare/main...mmkal:typebox:codex/script-jsdoc-description (patches `src/type/script/{parser,mapping,token}` — note typebox's type-level parser already skips comments, so static inference is unaffected by preserving them at runtime).
- **Why the old approach died**: PR #201 (merged then reverted; #202 closed) lazy-loaded `typebox/schema` via `createRequire(import.meta.url)`, which broke the bun browser-target build in `test_tgz` CI. The vendored module must contain **no Node-builtin imports** — upstream typebox source is dependency-free and browser-safe, so don't ruin that.

## Design decisions

- **Vendor strategy**: copy typebox **source** (`src/` of [sinclairzx81/typebox](https://github.com/sinclairzx81/typebox) at the `1.2.8` tag) into `src/typebox/vendor/`, committed to the repo, following the `src/zod-to-json-schema` precedent. A `cp-typebox.sh` script (modeled on `cp-zod-to-json-schema.sh`) pins the version, clones the tag, copies `src`, and rewrites deno-style `./foo.ts` import specifiers to `./foo.js` so the existing NodeNext tsc build compiles it untouched. Unlike `ztjs`, the script is for upgrades only — it is NOT part of `pnpm build`, because the vendored source carries local modifications (below). Modifications live in a patch file applied by the script (`git apply`) so upgrades stay tractable.
- **Local modifications to vendored source** (each modified file gets an attribution header summarizing the change, per house rules):
  1. jsdoc parsing in `Script`, adapted from the fork diff above: a jsdoc comment immediately preceding an object property becomes that property schema's `description`. Runtime only; type-level parser keeps ignoring comments.
- **Export surface**: new entrypoint `trpc-cli/typebox` (`src/typebox/index.ts`), NOT re-exported from root. Default export `Type` (matching upstream's `import Type from 'typebox'`) plus named exports (`Script`, `Compile`, `Value`, types, etc. — mirror upstream's root exports where sensible). The wrapper attaches `~standard` (non-enumerable, lazily-built via `Object.defineProperty` getter) to schemas returned by the public builders, so `console.log(schema)`/serialization still shows clean JSON Schema. `vendor: 'typebox'`. `validate` uses the vendored Value/Compile machinery; adapt typebox's MIT `example/standard` adapter with attribution (the old `src/typebox.ts` from commit e9c8057 is also a useful reference, minus its `createRequire`).
- **Package exports map**: add one — `"."`, `"./typebox"`, and a `"./*": "./*"` catch-all so documented deep imports like `trpc-cli/dist/proxify.js` keep working. Must pass `arethetypeswrong --profile esm-only` (CI does this on the packed tarball).
- **Generic `~standard.jsonSchema` detection** comes back in `src/json-schema.ts`, exactly as it was in e9c8057 (it's useful beyond typebox: any Standard JSON Schema-implementing library benefits).

## Checklist

- [x] `cp-typebox.sh` vendoring script: pin typebox `1.2.8` (track the version in package.json devDependencies for the script to read, as ztjs does), clone tag, copy `src` → `src/typebox/vendor`, rewrite `.ts` import extensions, apply local patch, write attribution headers (upstream repo, tag, commit, license, summary of modifications). _Done in 44443b0/37f8523 — `pnpm typebox` re-runs it; verified it reproduces the committed tree exactly. Patch lives in `src/typebox/jsdoc-description.patch`; attribution headers are part of the patch._
- [x] Vendored source committed and compiling under `pnpm compile` with no tsconfig weakening (typebox is strict; if its source needs minor lint/tsc accommodations, prefer per-directory eslint ignores over global rule changes). _Compiles clean with zero source/tsconfig accommodations; eslint ignores `src/typebox/vendor/**` like `src/zod-to-json-schema/**`._
- [x] jsdoc patch applied to vendored Script parser (runtime). Cover: property jsdoc on flat objects, nested objects, multi-line comments, comments that should NOT attach (e.g. inside strings); document known limitations in the test file. _All covered in test/typebox.test.ts, incl. the `// line comments don't attach` limitation. Adapted to 1.2.8's deferred-action PropertyMapping (description attached to the inner type before optional/readonly wrapping)._
- [x] `src/typebox/index.ts` wrapper: default `Type` export + named exports; `~standard` with `validate`, `vendor: 'typebox'`, `version: 1`, and `jsonSchema.input/output(options)` honoring `{target: 'draft-07'}` at minimum. _Plus `Script`/`Compile`/`Value` named exports and `export type *` for all upstream type names. Raw value exports deliberately not star-re-exported (unwrapped builders would be a trap)._
- [x] Restore generic `~standard.jsonSchema` support in `src/json-schema.ts` (from e9c8057). _Verbatim from e9c8057, plus the `{type: 'undefined'}` isOptional handling in parse-procedure.ts._
- [x] Exports map with `./*` catch-all; verify `trpc-cli/dist/proxify.js` deep import and attw esm-only profile. _attw esm-only passes on the packed tarball; deep import + `trpc-cli/typebox` + root verified at runtime from a clean install of the tarball._
- [x] No Node-builtin imports anywhere in `src/typebox/**` (grep for `node:`, `createRequire`, `module`, `fs`, `path`). _Grep clean. Also verified the original revert-trigger directly: `bun build` (browser target) and `bun build --compile` both succeed against the packed tarball, and the compiled binary runs._
- [x] Tests (`test/typebox.test.ts`): resurrect the e9c8057 coverage that still applies (primitives, enums, objects/options, optional, tuple, array, merged inputs) using the new import style, plus jsdoc-description cases and direct `~standard.validate` round-trips. _20 tests incl. expectTypeOf inference assertions and serialization-cleanliness._
- [x] Zero-peer-dependency test: norpc router + `trpc-cli/typebox` schemas + `createCli`, importing nothing from zod/@trpc/@orpc. _test/typebox-norpc.test.ts._
- [x] README: TypeBox section under validators — `import Type from 'trpc-cli/typebox'`, Script + jsdoc example, norpc zero-dependency example. Note vendoring rationale briefly with links to the two upstream discussions. _Committed in 310f2b0._
- [x] `pnpm build`, `pnpm lint`, `pnpm test` green; sanity-check package size impact of the vendored code (report in PR body). _All green locally. Tarball ~375K compressed (was ~100K); unpacked dist 316K → 6.8M (6.1M is the vendored typebox js+d.ts). Compile: ~1.4s → ~6s wall, peak RSS ~1.2GB._

## Open questions (decided here, revisit in review)

- Vendor all 8 typebox modules vs a subset: vendor all of `src/` for fidelity; tree-shakers handle unused code, and subsetting risks breaking internal imports on upgrade.
- Where to attach `~standard`: at the export-surface wrapper (chosen) vs inside the vendored factory chokepoint. Wrapper keeps the vendor diff minimal; nested sub-schemas won't carry `~standard`, which is fine since users pass top-level schemas to `.input(...)`.

## Reference

- PR #201 (merged then reverted): https://github.com/mmkal/trpc-cli/pull/201 — implementation commit e9c8057
- PR #202 (unrevert, closed for this rethink): https://github.com/mmkal/trpc-cli/pull/202
- Old task file: `tasks/complete/2026-05-05-typebox-support.md`
- jsdoc-in-Script issue: https://github.com/sinclairzx81/typebox/issues/1597
- standard-schema discussion: https://github.com/sinclairzx81/typebox/discussions/1152
- Upstream standard adapter example: https://github.com/sinclairzx81/typebox/tree/main/example/standard

## Implementation notes

- 2026-06-11 (late evening, review follow-up): addressed the fresh-eyes review on PR #205 (review 4479568858). (1) The task file claimed a `// line comments don't attach` test that didn't exist - added it to test/typebox.test.ts (line comments are trivia, no description attached), making the checklist claim true. (2) Added an upgrade reminder to cp-typebox.sh: new upstream concrete schema interfaces need matching declare-module entries in src/typebox/standard.ts or they silently lack type-level `~standard`. (3) Fixed the misindented `Type.Script` template literals in the README example and tests. (4) Deduplicated the Standard JSON Schema types into src/standard-schema/json-schema.ts, imported (type-only) by both src/json-schema.ts and src/typebox/standard.ts - this direction keeps src/json-schema.ts free of typebox imports AND keeps the trpc-cli/typebox d.ts graph free of json-schema.d.ts (whose declarations reference optional peer dep types). Public re-exports from trpc-cli/typebox unchanged. (5) Added a one-line README caveat about nested Script sub-schemas lacking runtime `~standard` (with the attachStandardSchema escape hatch). (6) Confirmed the global `{type: 'undefined'}` isOptional handling is intentional (dates to e9c8057): parse-procedure operates on vendor-less converted JSON Schema, `undefined` isn't a legal JSON Schema type so only typebox emits it, and "accepts undefined => optional" is correct for any emitter. No code change.

- 2026-06-11 (evening, OOM resolution): the tsc memory blow-up was bisected to its root cause. Declaring a required `~standard` member on the base `TSchema` interface OOMs tsc at the 4GB default heap **no matter how the member is typed** — `TypeboxStandardProps<Static<this>>` (12min grind → OOM), `TypeboxStandardProps<this>` with an `out` variance annotation (OOM in ~12s), and even a completely non-generic `TypeboxStandardProps<unknown>` (killed after 7min). `TSchema` is an empty interface that virtually every type in the 700-file vendored source gets structurally related to; any required member on it poisons every relation. Fix (d6aeff8): declare the member via declaration merging on the ~20 *concrete* schema interfaces (`TObject`, `TString`, `TTuple`, ...) which are what builders actually return and which are only related to each other. Compile is indistinguishable from the unaugmented baseline (~6s wall, ~1.2GB peak RSS, measured with /usr/bin/time -l), the full src+test typecheck passes in ~7.6s, and the `expectTypeOf` inference assertions all hold. The compile-script heap bump from a635b0e was reverted. The `TypeboxStandardProps` generic keeps the `out` variance annotation + conditional-deferred `Static` so same-kind generic relations (`TObject<A>` vs `TObject<B>`) relate schema types instead of expanding static types. Caveat for upgraders: a new concrete schema interface added upstream won't carry `~standard` until added to the declare-module list in `src/typebox/standard.ts`.

- 2026-06-11 19:20 ⚠️ COORDINATION (resolved): multiple concurrent claude instances were active on this worktree. The second session resolved the augmentation cost as described above; attw, deep-import smoke test, bun build, and PR body update all done. The expectTypeOf inference assertions were preserved (verified via vitest typecheck + tsc -p tsconfig.json).

- 2026-06-11: Task fleshed out from `tasks/typebox-vendored.ignoreme.md` (local draft) plus research into upstream issue #1597, discussion #1152, the e9c8057/c4fffb2 add/revert history, and CI's `test_tgz` bun browser-target constraint. Follow-up experiment (`createCli({module: './commands.ts'})` parsing plain TS functions via `Type.Script`) is a separate stacked task: `tasks/typebox-module-commands.md` on branch `typebox-module-commands`.
