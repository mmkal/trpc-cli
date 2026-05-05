---
status: ready
size: small
branch: agent-detection
---

# Add an agent-environment detection helper

## Status Summary

Spec is ready for a small implementation pass. The intended surface is a pure
exported helper with docs and tests; no CLI behavior should change unless users
opt into it by calling the helper.

## Summary Ask

Add a helper function that detects whether the current process appears to be
running inside a coding-agent environment such as Claude Code, Codex, or
opencode.

The primary motivating usage should be documented as:

```ts
await cli.run({
  prompts: isAgent() ? null : prompts,
})
```

That lets library consumers keep interactive prompts for humans while avoiding
prompt hangs or unhelpful interaction loops when a coding agent invokes the CLI.

## Guesses and Assumptions

- The helper should default to `process.env`, but accept an explicit env object
  in tests and for advanced embedding.
- The helper should be conservative: return true only for known signals from
  common coding agents, not for generic CI or non-interactive terminals.
- The helper should be exported from `src/index.ts` and documented in the README.
- The exact env-var list is allowed to evolve, but this first pass should cover
  Claude, Codex, and opencode without taking a dependency.
- If an agent's env vars are uncertain, document that uncertainty in code or test
  names rather than pretending the detection is exhaustive.

## Checklist

- [ ] Add a pure `isAgent` helper with an injectable environment object.
- [ ] Cover Claude, Codex, and opencode-style env vars with focused tests.
- [ ] Export the helper from the public package entrypoint.
- [ ] Document the `prompts: isAgent() ? null : prompts` use case.
- [ ] Run the focused tests plus compile or the full suite if the change touches
  shared types.

## Out of Scope

- Do not automatically disable prompts inside `createCli` or `run`.
- Do not detect generic CI, SSH, TTY absence, or editor terminals as coding
  agents.
- Do not add runtime dependencies.

