---
status: needs-grilling
size: medium
branch: deep-help
---

# Render deep command help

## Status Summary

Spec needs a short grill-you pass before implementation. The likely direction is
an exported helper or command-friendly value that renders a recursive tree of
help for all commands, including deeply nested commands, without forcing a
specific CLI command name on users.

## Summary Ask

Design and implement a way to render help for every command in a generated CLI
tree, not just the currently selected command. This should help humans and
agents inspect the complete command surface for nested routers.

Potential surfaces to evaluate:

- Override or compose Commander `helpInformation`.
- Export a `deepHelp(program)` helper that users can attach however they like.
- Provide an example like `help: t.procedure.query(() => deepHelp(cli.buildProgram()))`.

## Guesses and Assumptions

- The safest first surface is a library helper rather than a built-in command.
  Users can decide whether they want `help`, `deep-help`, or some custom
  procedure name.
- The output should be text, not JSON, because `toJSON()` already exists for
  structured inspection.
- The text should preserve Commander-generated option/argument help for each
  command while adding a readable command-path tree around it.
- The helper should work with any Commander `Command`, but tests should exercise
  a program produced by `createCli`.
- The implementation should not mutate the program or change normal `--help`
  behavior unless the user wires it in.

## Checklist

- [ ] Run a short grill-you interview to clarify the surface and output shape.
- [ ] Update this task with the resulting decisions and assumptions.
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

