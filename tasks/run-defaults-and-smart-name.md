---
status: in-progress
size: medium
branch: run-defaults-and-smart-name
---

# Unify run() defaults with the bin + smart default for `name`

## Status summary

Spec committed, implementation not started. Two breaking (pre-1.0) behavior changes:
`createCli(...).run()` gets the bin's nicer defaults (yaml-table logger, built-in prompts
for interactive humans), and `name` is derived automatically when not passed.

## Motivation

`createCli({...import.meta, name}).run()` should be the whole program. Today the trpc-cli
bin (`src/bin.ts`) papers over bad library defaults by passing `logger:
yamlTableConsoleLogger`, `prompts: isAgent() ? undefined : createBuiltInPrompts()`, and
`name: path.basename(filepath)` on every run. Library users who don't know to do that get
line-by-line JSON logging, no prompts, and `Usage: [options]` (no program name) in help
output. Make the good behavior the default and let explicit params override.

## 1. Unify `run()` defaults with the bin's

- [ ] Default logger becomes `yamlTableConsoleLogger` (was `lineByLineConsoleLogger`) in
      both `buildProgram` and `run` (src/index.ts:216, src/index.ts:652)
- [ ] Default prompts: when `runParams.prompts === undefined`, enable built-in prompts iff
      `!isAgent() && process.stdin.isTTY` (guard `typeof process` for non-node runtimes).
      Resolved in `run()` before the existing `promptify` call
- [ ] Explicit opt-out: `prompts: false` (and `null`, already in the type) disables
      prompting entirely; `prompts: true` forces built-in prompts even when the heuristic
      says no. Both already type-check (`Promptable | boolean | null`) - make sure the
      semantics hold and are documented
- [ ] Simplify `src/bin.ts`: drop `logger`, `prompts`, and `name` (see part 2) - it should
      just be `createCli({filename, jsonInput: 'auto'}).run({argv})`
- [ ] Update tests: `test/test-run.ts` passes an explicit logger so most tests are
      unaffected; e2e/bin fixtures that rely on the default logger will need snapshot
      updates (that's the visible point of the change)

## 2. Smart default for `name`

When `params.name` is not passed, derive it. Resolution order (first hit wins):

1. Explicit `name` param.
2. *Environment-derived* (only when `run()` is actually reading `process.argv`, i.e.
   `runParams.argv` was **not** provided - see "explicit argv gate" below):
   1. **Installed bin**: `realpath(process.argv[1])` matches a resolved `bin` entry in the
      nearest `package.json` above the script → use that bin's key. A string-form `bin`
      that matches → use the package name (scope stripped). Stop walking at the first
      `package.json` found; ignore fs/parse errors.
   2. **npm script**: `npm_lifecycle_event` is set, is not a runner artifact
      (`npx`/`dlx`), **and** `npm_lifecycle_script` mentions the entry script's basename
      → use the script name. The extra guard stops the env var (which is inherited by all
      child processes of any `npm run x`) from leaking into CLIs that merely run *under*
      an npm script, e.g. a trpc-cli-built tool spawned by `npm run build`.
   3. **Entry script basename**: `basename(process.argv[1])` minus extension. Uses argv[1]
      as-typed (not realpath'd) so a symlinked `node_modules/.bin/mycli` yields `mycli`.
3. *Module mode*: basename of the commands module (`filename`/`url`) minus extension.
   Deterministic (no env sniffing) so it applies even with explicit argv - this is what
   lets bin.ts drop its `name` param. Not applicable to the `{source, exports}` escape
   hatch.
4. Unset - commander's existing behavior (`Usage: [options] ...`).

### Explicit argv gate

Environment-derived names only apply when the run is environment-driven. Passing
`runParams.argv` means programmatic usage (tests, embedding) where `process.argv[1]` /
npm env vars describe the *host* process (e.g. a vitest worker), not the CLI - deriving a
name from them would be garbage and nondeterministic. Same reasoning as the existing
`jsonFlagSniffed` logic: `buildProgram()`/`toJSON()` with no runParams have no invocation
to sniff, so they don't get env-derived names either. Prompts do NOT get this gate - the
prompt heuristic is about the human at the terminal, which the TTY check detects
regardless of where argv came from.

- [ ] Implement resolution (new `src/resolve-name.ts` or similar; needs `node:fs` via the
      same top-level `await import(...).catch(String)` soft-dependency pattern used for
      `@orpc/server`, so non-node runtimes degrade to skipping env rules)
- [ ] Module-mode default name in the `createCli` module branch
- [ ] Tests: name resolution unit tests (bin match, lifecycle guard, basename, precedence,
      explicit-argv gate); e2e fixture snapshots now show real program names
- [ ] Document the resolution order in the README (new subsection near `createCli` params)
- [ ] Check `--help` output looks right: router mode via installed bin, `node script.js`,
      npm script; module mode via `createCli(import.meta)` and the `trpc-cli` bin

## Both

- [ ] README updates: prompts section (defaults changed, `prompts: false`), logging
      section (default is yaml-table now), bin section (defaults no longer bin-specific)
- [ ] Breaking-change notes: repo has no changeset infra, so the PR body (squash-merge
      commit message → release notes) carries the breaking-change notice prominently

## Assumptions made (user was AFK)

- Prompts default requires **both** non-agent and TTY stdin ("probably also only when
  stdin is a TTY" in the prompt - confirmed as a hard requirement here).
- `npm_lifecycle_event` is used, but only with the `npm_lifecycle_script`-mentions-entry
  guard, to prevent env leakage into spawned grandchildren. Without the guard, every CLI
  run under `npm run anything` would be named `anything`.
- Environment-derived naming is gated on not passing explicit `argv`; module-filename
  naming is not gated (deterministic either way).
- No changeset file added since the repo doesn't use changesets; PR body is the changelog.

## Implementation log

(append notes here during implementation)
