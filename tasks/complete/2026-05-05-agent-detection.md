---
status: done
size: small
branch: agent-detection
---

# Add an agent-environment detection helper

## Status Summary

Done. Added a pure exported `isAgent` helper, covered Claude Code/Codex/opencode
signals with tests, documented agent-aware prompt disabling, and verified with
focused tests, compile, and lint. No missing implementation pieces remain.

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

- [x] Add a pure `isAgent` helper with an injectable environment object. _Implemented in `src/agent.ts` with a `process.env` default and injectable `AgentEnvironment`._
- [x] Cover Claude, Codex, and opencode-style env vars with focused tests. _Added `test/agent.test.ts` for `CLAUDECODE`, Codex `CODEX_*`, opencode worker env, and non-agent false positives._
- [x] Export the helper from the public package entrypoint. _Exported `isAgent` and `AgentEnvironment` from `src/index.ts`._
- [x] Document the `prompts: isAgent() ? null : prompts` use case. _Updated the README input prompt example to disable prompts only for detected coding agents._
- [x] Run the focused tests plus compile or the full suite if the change touches
  shared types. _Ran focused Vitest files, `pnpm compile`, and `pnpm lint`; all passed._

## Out of Scope

- Do not automatically disable prompts inside `createCli` or `run`.
- Do not detect generic CI, SSH, TTY absence, or editor terminals as coding
  agents.
- Do not add runtime dependencies.

## Implementation Notes

- 2026-05-05: `TrpcCliRunParams.prompts` now accepts `null` so the documented
  agent-aware prompt disabling example type-checks while preserving existing
  runtime behavior.
- 2026-05-05: `pnpm install --frozen-lockfile` was needed because the worktree
  had no `node_modules`; it used the existing lockfile and made no dependency
  changes.
