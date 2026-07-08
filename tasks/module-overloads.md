---
status: implemented
size: medium
branch: module-overloads
pr: https://github.com/mmkal/trpc-cli/pull/214
---

# Support TS function overloads in module mode

## Status summary

Implemented and tested (full suite green). Overload signatures with single object
parameters become alternate calling conventions: per-signature usage lines in help,
merged flags with conflicts, first-match validation with closest-match-first errors.
Remaining: nothing blocking; possible follow-ups listed at the bottom.

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

This produces a `resize` command whose help shows both ways to call it, whose flags are
the union of both signatures' flags, and whose validation accepts an invocation iff it
matches at least one signature (checked in declaration order).

Note the runtime function's *implementation* already dispatches on the input shape -
that's what overload implementations do - so for object-parameter overloads the CLI
doesn't need to know which signature matched; it just passes the validated object.

## Design decisions (made autonomously - flagging assumptions)

- **Scope: flags-only overloads.** Each participating signature must be a single
  object(-like) parameter. This is where overloads make CLI sense: alternate *flag sets*.
  Signatures with positional parameters keep today's first-signature-wins behavior
  (positionals that differ per overload have no clean commander representation).
- **Validation = first match wins, in declaration order** (mirrors TS overload
  resolution). Each signature's schema is built with the existing machinery, then
  combined as `{anyOf: [...]}` with a hand-attached `~standard` validator that tries each
  signature's validator in order and returns the first success.
- **No-match errors: report each signature's error, closest match first.** "Closest" =
  fewest issues, ties broken by declaration order. Each line is labeled with the
  signature's flags summary.
- **Help: one usage line per overload** (required flags as `--flag <type>`, optional
  bracketed, `true` literals and booleans as bare flags, literal unions as choices), with
  the overload's jsdoc as an aligned trailing `# comment`. Rendered via the existing
  `meta.usage` array support, plus a small index.ts improvement that aligns multi-line
  usage under `Usage: ` with the full command prefix repeated (previously continuation
  lines rendered unindented at column 0 - benefits every meta.usage array user).
- **Per-overload jsdoc**: the first signature's jsdoc remains the command description;
  each signature's jsdoc (first line) becomes its usage line's comment. `@alias` is only
  honored on the first signature's jsdoc.
- **Class methods get the same treatment** via a shared `groupOverloadDeclarations`.
- **Shared-flag metadata propagation**: the union flag-merge keeps the *last* occurrence
  of each property, so descriptions/`@alias` declared on one signature are copied onto
  same-named undocumented properties in other signatures (cosmetic only).

## Checklist

- [x] extraction: collect *all* body-less overload signatures per export name (ordered) _`groupOverloadDeclarations` in module-commands.ts, shared by functions and class methods; implementation signature still excluded when signatures exist_
- [x] procedure building: ≥2 single-object-param signatures → first-match union with hand-attached `~standard` validator _`buildOverloadedProcedure` + `validateOverloads`_
- [x] fallback: any signature with positionals (or otherwise non-object/unparseable) → first-signature-wins _`buildOverloadedProcedure` returns undefined, `buildProcedure` falls through_
- [x] no-match error message: per-signature error lines, fewest-issues-first, labeled with flags summary _single multi-line issue rendered by the existing prettifier_
- [x] help: per-overload usage lines with per-overload jsdoc comments _`overloadFlagsSummary` + meta.usage array + index.ts multi-line usage alignment_
- [x] class methods: same overload support _`extractClassMethodDeclarations` returns signature groups_
- [x] tests _new: alternate-calling-conventions (help snapshot, dispatch, conflicts, no-match errors), named types + required literals, class method overloads; updated: the two first-overload-wins pins (one became the feature test, the positional one stays as the fallback pin)_
- [x] README docs _overloads example with console output in the module-mode section; limitations bullet rewritten_
- [x] PR note: feasibility of equivalent support in trpc/orpc mode _in PR body_

## Implementation notes

- The existing union-of-objects machinery did most of the heavy lifting: `flattenedProperties`
  merges `anyOf` flags, `incompatiblePropertyPairs` + commander `conflicts` already reject
  mixing flags across signatures, and `parse-procedure` accepts anyOf-of-objects as a flags
  schema. The new work was extraction (keep all signatures), the ordered first-match
  validator with grouped errors, usage-line generation, and metadata propagation.
- The vendored typebox `~standard.validate` is synchronous and passes values through
  unchanged (no coercion/defaults), so first-match checking is purely about error
  reporting/order semantics - `validateOverloads` throws if a variant validator ever
  returns a Promise (it can't today).
- Overloads of a *scalar* parameter (e.g. `(x: string)` / `(x: number)`) also fall back to
  first-signature: alternate positional layouts aren't representable.

## Review feedback round 1 (2026-07-08)

- "misleadingly universal" description: the first signature's jsdoc no longer poses as the
  command description. Precedence now: implementation-signature jsdoc (the new home for an
  overall description) > signatures' distinct descriptions joined with ' / '. `@alias` is
  honored wherever declared (implementation or any signature).
- Flag descriptions now advertise incompatibilities (`Do not use with: --scale`), derived
  from the same `incompatiblePropertyPairs` that powers commander `conflicts`. Implemented
  generically in index.ts, so zod/trpc union inputs get it too (migrations fixture
  snapshots updated accordingly).
- A flag documented *differently* across signatures shows every distinct description
  joined with ' / ' (previously last-write-wins). Jsdoc declared in only one signature
  already propagated; now pinned by tests.

## Possible follow-ups (not done)

- Overloads whose positional params are textually identical, differing only in the
  trailing options object, could union just the trailing object.
- trpc/orpc mode: unions of objects already work there (`z.union([...])`); what's missing
  is only the per-variant usage lines/descriptions presentation. See PR note.
