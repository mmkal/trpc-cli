---
status: complete
size: medium
branch: built-in-prompts
---

# Explore built-in prompts

## Status Summary

Implementation is complete and ready for review. The branch adds a
dependency-free built-in prompter, exposes `prompts: true`, documents when to use
external prompt libraries, and covers input/select/checkbox/confirm prompting
with injected stream tests. Remaining risk is limited to the deliberately plain
line-oriented UX, not a Clack/Inquirer-style TUI.

## Summary Ask

Investigate whether `trpc-cli` can provide a built-in prompt implementation so
users do not need to install and pass a separate prompts library for common
interactive usage.

The current project already adapts several prompt libraries through
`src/prompts.ts`. This experiment should determine whether one implementation is
small and modern enough to vendor directly while keeping the public `Promptable`
shape intact.

## Current Research Notes

- `@clack/prompts` latest observed npm version on 2026-05-05 is `1.3.0`, MIT,
  with runtime dependencies on `@clack/core`, `fast-string-width`,
  `fast-wrap-ansi`, and `sisteransi`; `npm view` reported unpacked size
  220,069 bytes during implementation.
- `@inquirer/prompts` latest observed npm version on 2026-05-05 is `8.4.2`,
  MIT, but it is a wrapper around many `@inquirer/*` packages; `npm view`
  reported unpacked size 23,379 bytes for the wrapper, not the transitive prompt
  packages.
- `enquirer` latest observed npm version on 2026-05-05 is `2.4.1`, MIT, with
  `ansi-colors` and `strip-ansi` dependencies; `npm view` reported unpacked size
  188,681 bytes.
- `prompts` latest observed npm version on 2026-05-05 is `2.4.2`, MIT, with
  `kleur` and `sisteransi` dependencies; `npm view` reported unpacked size
  186,815 bytes.
- The repo currently has dev dependencies for `@clack/prompts`,
  `@inquirer/prompts`, `enquirer`, and `prompts`, but runtime dependencies only
  include `commander`.
- Decision: do not vendor upstream prompt code. The implemented built-in prompter
  is local original code and intentionally line-oriented, so no runtime
  dependency or upstream attribution block is needed.

## Guesses and Assumptions

- Prefer vendoring a minimal local prompt implementation over adding a runtime
  dependency. The package currently has a very small runtime dependency surface.
- A built-in prompter does not need to clone every upstream feature; it only has
  to satisfy this package's `Prompter` interface well enough for input, confirm,
  select, and checkbox prompts.
- If vendoring upstream code, include explicit attribution and a summary of
  modifications at the top of inspired source files.
- If a clean vendored implementation is too large or brittle, stop with a task
  update and PR notes rather than forcing a bad built-in prompt API.

## Checklist

- [x] Compare modern prompt-library candidates by size, dependency surface,
  license, and API fit. _Used current `npm view` data for Clack, Inquirer,
  Enquirer, and prompts; none were small enough to justify a new runtime dep for
  this narrow interface._
- [x] Choose either a vendored built-in implementation or an explicit no-go
  recommendation. _Chose local original code rather than vendoring upstream TUI
  internals._
- [x] If implementing, add an exported built-in prompter and wire it into the
  existing `Promptable` path without breaking external prompt adapters. _Added
  `createBuiltInPrompts`, `builtInPrompts`, and `prompts: true` handling while
  leaving existing adapter detection unchanged._
- [x] Add tests for input, confirm, select, and checkbox behavior using injected
  streams or another deterministic non-mocking approach. _Added a stream-injected
  `createCli` integration test in `test/prompts.test.ts`._
- [x] Document how to use the built-in prompt support and when to keep using an
  external prompt library. _Updated the README input prompts section with
  `prompts: true`, `createBuiltInPrompts`, and external library guidance._
- [x] Run focused prompt tests plus compile or the full suite if shared types
  change. _Ran `pnpm vitest run test/prompts.test.ts`, `pnpm compile`,
  `pnpm lint`, and `pnpm test` successfully._

## Implementation Notes

- Added `src/built-in-prompts.ts` with plain line prompts:
  - input reads one line and applies defaults/validation.
  - confirm accepts yes/no forms.
  - select prints numbered choices and accepts number, value, or name.
  - checkbox prints numbered choices and accepts comma/space-separated numbers,
    `all`, or `none`.
- The local line reader buffers prefilled streams so tests can inject all answers
  up front without losing later prompt responses.
- `run({prompts: true})` constructs the built-in prompter lazily. Users needing
  custom streams can pass `createBuiltInPrompts({input, output})`.

## Out of Scope

- Do not add a large runtime dependency just to make prompts built-in.
- Do not remove support for existing prompt libraries.
- Do not attempt to fully reproduce Clack or Inquirer styling.
