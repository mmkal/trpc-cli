---
status: ready
size: medium
branch: deep-help
pr: 197
---

# Render deep command help

## Status Summary

Spec is ready for implementation after a grill-you pass. The selected direction
is a standalone `deepHelp(program)` helper that renders full Commander help
blocks for every visible node in depth-first order; no normal `--help` behavior
should change.

## Summary Ask

Design and implement a way to render help for every command in a generated CLI
tree, not just the currently selected command. This should help humans and
agents inspect the complete command surface for nested routers.

Selected surface:

```ts
import {createCli, deepHelp} from 'trpc-cli'

const cli = createCli({router})
console.log(deepHelp(cli.buildProgram()))
```

Users can expose the returned string however they like, including from their own
procedure:

```ts
help: t.procedure.query(() => deepHelp(cli.buildProgram()))
```

## Guesses and Assumptions

- The safest first surface is a library helper rather than a built-in command.
  Users can decide whether they want `help`, `deep-help`, or some custom
  procedure name.
- The output should be text, not JSON, because `toJSON()` already exists for
  structured inspection.
- The text should preserve Commander-generated option/argument help for each
  command while adding `=== full command path ===` headings around each block.
- The helper should work with any Commander `Command`, but tests should exercise
  a program produced by `createCli`.
- The implementation should not mutate the program or change normal `--help`
  behavior unless the user wires it in.
- [guess: this is most useful to coding agents because it preserves both routing
  context and exact command usage.]
- [guess: if users like it, a `TrpcCli` method can be added later without
  breaking compatibility.]
- [guess: a single stable format is more valuable than configurability for this
  experimental helper.]

## Checklist

- [x] Run a short grill-you interview to clarify the surface and output shape.
  _Captured decisions in `tasks/deep-help.interview.md`: standalone helper, full
  help blocks for every visible node, `=== path ===` headings._
- [x] Update this task with the resulting decisions and assumptions. _Task now
  records the selected API, output shape, and carried-forward guesses from the
  interview._
- [ ] Add tests for recursive help across at least three nested command levels.
- [ ] Implement the selected public helper or command surface.
- [ ] Document how users can expose the helper from their own router.
- [ ] Run focused help tests plus compile or the full suite if shared types
  change.

## Out of Scope

- Do not replace Commander help globally.
- Do not add markdown, rich terminal formatting, or JSON output in this pass.
- Do not require users to reserve a command name unless the grill-you pass makes
  that tradeoff explicit.

