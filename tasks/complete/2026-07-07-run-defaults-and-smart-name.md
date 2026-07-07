---
status: done
size: medium
branch: run-defaults-and-smart-name
pr: https://github.com/mmkal/trpc-cli/pull/212
---

# Unify run() defaults with the bin + smart default for `name`

## Status summary

Done, PR open. Both breaking (pre-1.0) behavior changes implemented, tested and documented:
`createCli(...).run()` now defaults to the yaml-table logger and built-in prompts for
interactive humans (TTY + not a coding agent), and `name` is derived automatically when
not passed (bin entry > npm script > entry basename > module-file basename). bin.ts is
down to `createCli({filename, jsonInput: 'auto'}).run({argv})`.

## Motivation

`createCli({...import.meta, name}).run()` should be the whole program. Today the trpc-cli
bin (`src/bin.ts`) papers over bad library defaults by passing `logger:
yamlTableConsoleLogger`, `prompts: isAgent() ? undefined : createBuiltInPrompts()`, and
`name: path.basename(filepath)` on every run. Library users who don't know to do that get
line-by-line JSON logging, no prompts, and `Usage: [options]` (no program name) in help
output. Make the good behavior the default and let explicit params override.

## 1. Unify `run()` defaults with the bin's

- [x] Default logger becomes `yamlTableConsoleLogger` _(both spots in src/index.ts:
      buildProgram and run)_
- [x] Default prompts: built-in prompts iff `!isAgent() && process.stdin.isTTY` _(resolved
      in `run()` before the promptify call, with a `typeof process` guard)_
- [x] Explicit opt-out: `prompts: false`/`null` disables, `prompts: true` forces built-in
      _(semantics unchanged from before, now documented in TrpcCliRunParams jsdoc + readme)_
- [x] Simplify `src/bin.ts` _(now just `createCli({filename, jsonInput: 'auto'}).run({argv})`)_
- [x] Update tests _(3 e2e snapshots updated to show yaml/table output - the visible point
      of the change; everything else was already passing explicit loggers)_
- [x] Bonus small logger fix: `yamlTableConsoleLogger` now prints arrays of primitives
      line-by-line like the other loggers, instead of as a yaml list that quote-wraps
      strings containing `: ` _(src/logging.ts renderYamlTableValue; the migrations e2e
      output would otherwise have regressed to `- "one: executed"`)_

## 2. Smart default for `name`

- [x] Implement resolution _(src/resolve-name.ts: `guessCliName` = bin-entry match >
      npm_lifecycle_event (guarded) > argv[1] basename; soft `node:fs` import so non-node
      runtimes skip env rules)_
- [x] Module-mode default name _(module branch of createCli passes the commands-file
      basename down via a new internal-ish `defaultName` param on TrpcCliParams)_
- [x] Tests _(test/resolve-name.test.ts unit tests incl. temp-package bin fixtures; e2e
      tests for lifecycle-derived + basename-derived names; in-process module-name test in
      typebox-module-commands.test.ts; bin.test.ts "named after the module file" now
      exercises the new default)_
- [x] Document the resolution order in the README _(new "How the CLI name is resolved"
      section)_
- [x] Check `--help` output in each case _(e2e snapshots + a manual smoke test of the
      installed-bin case against the built dist: `Usage: my-neat-tool`)_

### Resolution order (as implemented)

1. Explicit `name` param.
2. Environment-derived - only when `run()` reads `process.argv` (no explicit `argv` param;
   explicit argv = programmatic usage where process.argv/npm env describe the host, not
   the CLI - same reasoning as the existing `jsonFlagSniffed` gate):
   1. `bin` entry in the entry script's nearest package.json whose realpath matches the
      entry script → bin key (string-form bin → package name, scope stripped)
   2. `npm_lifecycle_event`, excluding `npx`/`dlx`, and only when `npm_lifecycle_script`
      mentions the entry script's basename (prevents the env var, inherited by all child
      processes of any `npm run x`, leaking into CLIs merely spawned under it)
   3. entry script basename minus extension (matches what commander did by itself)
3. Module mode: commands-file basename (deterministic, so not gated on argv - this is what
   lets bin.ts drop its `name` param).
4. Unset (commander behavior unchanged).

## Both

- [x] README updates _(prompts section rewritten around the new default + `prompts: false`;
      Output and Lifecycle rewritten for the yaml-table default with a lineByLine escape
      hatch for piping; bin section; features list; new name-resolution section; TOC
      regenerated)_
- [x] Breaking-change notes _(no changeset infra in this repo - the PR body, which becomes
      the squash-merge commit message → release notes, carries the notice)_

## Assumptions made (user was AFK)

- Prompts default requires **both** non-agent and TTY stdin.
- `npm_lifecycle_event` is used, but only with the `npm_lifecycle_script`-mentions-entry
  guard, to prevent env leakage into spawned grandchildren.
- Environment-derived naming is gated on not passing explicit `argv`; module-filename
  naming is not gated (deterministic either way).
- No changeset file added since the repo doesn't use changesets; PR body is the changelog.
- Bin-entry match ranks **above** the module-file basename, so a packaged
  `createCli(import.meta)` CLI run as `node dist/commands.js` is still named after its bin.

## Implementation log

- Full suite green (414 passed / 2 skipped, typecheck clean), `pnpm build` clean, eslint
  clean (readme codegen blocks unchanged - they only contain help output and primitive
  results).
- Smoke-tested against built dist: fake package with `bin: {"my-neat-tool": "./cli.mjs"}`
  run as `node cli.mjs --help` shows `Usage: my-neat-tool`; piped-stdin run with missing
  args fails fast instead of hanging on a prompt.
- `defaultName` lives on the public `TrpcCliParams` type (jsdoc steers users to `name`) -
  alternative was threading module info into buildProgram some other way; this was the
  smallest seam. Flag in review if it feels too public.
