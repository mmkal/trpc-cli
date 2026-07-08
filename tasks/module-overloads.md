---
status: in-progress
size: medium
branch: module-overloads
---

# Support TS function overloads in module mode

## Status summary

Spec fleshed out, implementation not started. Main pieces: extraction of all overload
signatures (currently first-signature-wins), a first-match union validator with
per-overload error reporting, per-overload usage lines in help, tests, README docs.

## Motivation

Module mode currently detects TS overload signatures but throws away all but the first
(see the dedupe in `extractModuleCommands`, with tests pinning that behavior). Overloads
are the natural TypeScript idiom for "this function has two alternate calling
conventions", which maps directly to a CLI command with two alternate invocation forms:

```ts
/** resize by explicit dimensions */
export function resize(params: {input: string; width: number; height: number}): Promise<string>
/** resize by scale factor, preserving aspect ratio */
export function resize(params: {input: string; scale: number}): Promise<string>
export function resize(params: {input: string; width?: number; height?: number; scale?: number}) {
  // runtime implementation handles both shapes
}
```

This should produce a `resize` command whose help shows both ways to call it, whose
flags are the union of both signatures' flags, and whose validation accepts an
invocation iff it matches at least one signature (checked in declaration order).

Note the runtime function's *implementation* already dispatches on the input shape -
that's what overload implementations do - so for object-parameter overloads the CLI
doesn't need to know which signature matched; it just passes the validated object.

## Design decisions (made autonomously - flagging assumptions)

- **Scope: flags-only overloads.** Each participating signature must be a single
  object(-like) parameter. This is where overloads make CLI sense: alternate *flag sets*.
  Signatures with positional parameters keep today's first-signature-wins behavior
  (positionals that differ per overload have no clean commander representation).
  *Stretch*: overloads whose positional params are textually identical and only the
  trailing options object differs could union just the trailing object - only do this if
  it falls out naturally.
- **Validation = first match wins, in declaration order** (mirrors TS overload
  resolution). Build each signature's schema with the existing machinery, then combine
  as `{anyOf: [...]}` with a hand-attached `~standard` validator that tries each
  signature's validator in order and returns the first success.
- **No-match errors: report each signature's error, closest match first.** "Closest" =
  fewest issues (the user's "prioritise whichever error message is smaller" heuristic),
  ties broken by declaration order. Label each group so the user can tell which calling
  convention each error block refers to.
- **Help: one usage line per overload**, derived from each signature's schema (required
  flags as `--flag <value>`, optional as `[--flag <value>]`), with the overload's own
  jsdoc as a trailing/adjacent description. Exact rendering mechanism (multi-line
  `command.usage()` via the existing `meta.usage` array support vs `addHelpText`) to be
  settled by snapshot tests - whichever reads best. The merged flags list stays as-is
  (the existing union-of-objects flag derivation + `incompatiblePropertyPairs`
  conflicts already handle it).
- **Per-overload jsdoc**: the jsdoc on the *first* signature remains the command
  description; each signature's jsdoc also describes its variant in the usage lines.
  `@alias` etc. are only honored on the first signature's jsdoc.
- **Class methods get the same treatment** - the extraction dedupe is duplicated in
  `extractClassMethodDeclarations`; share the new logic.
- **`{source, exports}` and file-backed modes both supported** - this is all
  source-extraction + schema work, no loader changes.

## Checklist

- [ ] extraction: collect *all* body-less overload signatures per export name (ordered), not just the first; implementation signature still excluded when signatures exist
- [ ] procedure building: when ≥2 signatures and all are single-object params, build per-signature schemas and combine into a first-match union with hand-attached `~standard` validator
- [ ] fallback: any signature with positionals (or otherwise non-object) → current first-signature-wins behavior
- [ ] no-match error message: per-signature error groups, fewest-issues-first, clearly labeled
- [ ] help: per-overload usage lines with per-overload jsdoc descriptions
- [ ] class methods: same overload support
- [ ] tests in test/typebox-module-commands.test.ts (help snapshot, first-match runtime dispatch, error output, class methods, jsdoc per overload); update the two existing first-overload-wins tests
- [ ] README docs for module mode overloads (via readme-codegen if applicable)
- [ ] PR note: feasibility of equivalent support in trpc/orpc mode

## Implementation notes

(log as work happens)
