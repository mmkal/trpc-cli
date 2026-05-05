---
status: ready
size: medium
branch: built-in-prompts
---

# Explore built-in prompts

## Status Summary

Spec is ready for an experimental implementation pass. The target is to vendor a
small, modern prompt implementation if it stays legally and technically cheap;
otherwise the branch should document why external prompt adapters remain better.

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
  `fast-wrap-ansi`, and `sisteransi`.
- `@inquirer/prompts` latest observed npm version on 2026-05-05 is `8.4.2`,
  MIT, but it is a wrapper around many `@inquirer/*` packages.
- The repo currently has dev dependencies for `@clack/prompts`,
  `@inquirer/prompts`, `enquirer`, and `prompts`, but runtime dependencies only
  include `commander`.

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

- [ ] Compare modern prompt-library candidates by size, dependency surface,
  license, and API fit.
- [ ] Choose either a vendored built-in implementation or an explicit no-go
  recommendation.
- [ ] If implementing, add an exported built-in prompter and wire it into the
  existing `Promptable` path without breaking external prompt adapters.
- [ ] Add tests for input, confirm, select, and checkbox behavior using injected
  streams or another deterministic non-mocking approach.
- [ ] Document how to use the built-in prompt support and when to keep using an
  external prompt library.
- [ ] Run focused prompt tests plus compile or the full suite if shared types
  change.

## Out of Scope

- Do not add a large runtime dependency just to make prompts built-in.
- Do not remove support for existing prompt libraries.
- Do not attempt to fully reproduce Clack or Inquirer styling.

