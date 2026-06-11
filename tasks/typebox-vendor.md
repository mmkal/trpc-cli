---
status: in-progress
size: large
branch: typebox-vendor
---

# Vendor TypeBox: `trpc-cli/typebox` with jsdoc descriptions + standard-schema

## Status Summary

Mostly done. Vendored source + jsdoc patch + `trpc-cli/typebox` wrapper + restored Standard JSON Schema detection + tests + README are all in. Remaining: confirm a cold `pnpm build` memory issue (tsc OOM'd once at the default 4GB heap on a clean dist), attw verification on a packed tarball, and CI green. This is the "broader rethink" promised when PR #202 was closed.

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

- [ ] `cp-typebox.sh` vendoring script: pin typebox `1.2.8` (track the version in package.json devDependencies for the script to read, as ztjs does), clone tag, copy `src` → `src/typebox/vendor`, rewrite `.ts` import extensions, apply local patch, write attribution headers (upstream repo, tag, commit, license, summary of modifications).
- [ ] Vendored source committed and compiling under `pnpm compile` with no tsconfig weakening (typebox is strict; if its source needs minor lint/tsc accommodations, prefer per-directory eslint ignores over global rule changes).
- [ ] jsdoc patch applied to vendored Script parser (runtime). Cover: property jsdoc on flat objects, nested objects, multi-line comments, comments that should NOT attach (e.g. inside strings); document known limitations in the test file.
- [ ] `src/typebox/index.ts` wrapper: default `Type` export + named exports; `~standard` with `validate`, `vendor: 'typebox'`, `version: 1`, and `jsonSchema.input/output(options)` honoring `{target: 'draft-07'}` at minimum.
- [ ] Restore generic `~standard.jsonSchema` support in `src/json-schema.ts` (from e9c8057).
- [ ] Exports map with `./*` catch-all; verify `trpc-cli/dist/proxify.js` deep import and attw esm-only profile.
- [ ] No Node-builtin imports anywhere in `src/typebox/**` (grep for `node:`, `createRequire`, `module`, `fs`, `path`).
- [ ] Tests (`test/typebox.test.ts`): resurrect the e9c8057 coverage that still applies (primitives, enums, objects/options, optional, tuple, array, merged inputs) using the new import style, plus jsdoc-description cases and direct `~standard.validate` round-trips.
- [ ] Zero-peer-dependency test: norpc router + `trpc-cli/typebox` schemas + `createCli`, importing nothing from zod/@trpc/@orpc.
- [ ] README: TypeBox section under validators — `import Type from 'trpc-cli/typebox'`, Script + jsdoc example, norpc zero-dependency example. Note vendoring rationale briefly with links to the two upstream discussions.
- [ ] `pnpm build`, `pnpm lint`, `pnpm test` green; sanity-check package size impact of the vendored code (report in PR body).

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

- 2026-06-11 19:20 ⚠️ COORDINATION: multiple concurrent claude instances are active on this same worktree (a second session has been live since 18:24 and is currently bisecting a tsc memory blow-up apparently caused by the `declare module` TSchema `~standard` augmentation in `src/typebox/standard.ts` — cold compiles OOM at node's default ~4GB heap). This instance is leaving `src/typebox/standard.ts` uncommitted/hands-off for that session and has committed only additive files (README section, compile-script heap bump, this note). Whoever resolves the augmentation cost: make sure the `static inference flows into procedures` expectTypeOf assertions in test/typebox.test.ts still pass — replacing the generic with `unknown` would silently break input inference. Remaining checklist after that: attw esm-only check on a packed tarball, deep-import smoke test, CI green, PR #205 body update.

- 2026-06-11: Task fleshed out from `tasks/typebox-vendored.ignoreme.md` (local draft) plus research into upstream issue #1597, discussion #1152, the e9c8057/c4fffb2 add/revert history, and CI's `test_tgz` bun browser-target constraint. Follow-up experiment (`createCli({module: './commands.ts'})` parsing plain TS functions via `Type.Script`) is a separate stacked task: `tasks/typebox-module-commands.md` on branch `typebox-module-commands`.
