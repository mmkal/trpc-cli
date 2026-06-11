---
status: ready
size: medium
---

# Unified JSON input: `--json` everywhere, argv-sniffing global mode

## Status Summary

Spec committed, implementation not started. This is the alternate, much simpler design for what PR #199 (`json-mode` branch, now back in draft) implements with a Commander subclass and conflict wiring. Decisions below were made in discussion with the owner on 2026-06-10/11.

## Goal

One concept: `--json <json>` supplies the *complete procedure input* as JSON. `jsonInput: true` turns it on — per procedure via `meta.jsonInput` (already exists, currently exposed as `--input`), or globally via `createCli({jsonInput: true})` (new).

Breaking change (v0, accepted by owner): the per-procedure/fallback JSON option is renamed `--input [json]` → `--json <json>`. `--input` is removed.

## Design

### The argv-sniffing trick (the core idea)

The CLI program is built just-in-time per invocation, and `buildProgram(runParams)` already receives the argv. So global JSON mode doesn't need hybrid commands that accept both flags *and* `--json` (which is what forced #199's Commander subclass, `conflicts()` wiring, runtime positional rejection, and internal-attribute-name tricks). Instead, with `createCli({jsonInput: true})`:

- **If `--json` is present in argv** → build every leaf command JSON-only (the existing `jsonProcedureInputs` path in `src/parse-router.ts`). Schema-derived flags/positionals don't exist in this build, so there is nothing to conflict with. Supplying other flags alongside `--json` yields Commander's normal "unknown option" error, which is the correct message for free.
- **If `--json` is absent** → build commands normally from schemas, plus register a *cosmetic* visible `--json <json>` option on leaf commands so it appears in `--help`. This option is provably unreachable: any invocation that actually passes `--json` would have been built in JSON mode. No parsing logic needed behind it.

The two modes are mutually exclusive by construction. No subclass, no conflicts, no runtime checks.

### Detection rule

A token activates JSON mode iff it is exactly `--json` or starts with `--json=`, and occurs **before** any bare `--` terminator. Source of truth is the argv that will actually be parsed: `runParams.argv` when provided (tests pass this), else `process.argv.slice(2)`. Never sniff `process.argv` when an explicit argv was supplied.

### Semantics

- `meta.jsonInput: true` → that procedure is always JSON-only (current behavior, new flag name).
- `createCli({jsonInput: true})` → argv-sniffing hybrid for all procedures, as above.
- `meta.jsonInput: false` under global mode → opts that procedure out: always built from its schema, no cosmetic `--json` in its help, and `--json` invocations against it fail with unknown option.
- Unparseable-schema fallback (already exists) → JSON-only with the new `--json` flag, regardless of any setting.
- The JSON payload goes through the procedure's own validation as today (`getPojoInput` returns `options.json`).

## Checklist

- [ ] Rename the JSON option in `jsonProcedureInputs` (`src/parse-router.ts`) from `input` to `json`, including `getPojoInput` and the description. Update all existing tests/snapshots that reference `--input` JSON fallback usage.
- [ ] Add `jsonInput?: boolean` to `TrpcCliParams` (`src/types.ts`) with a jsdoc explaining the global hybrid behavior.
- [ ] Implement argv detection in `buildProgram` (`src/index.ts`) per the detection rule above, and thread "JSON mode active" into command construction (use `jsonProcedureInputs` for leaves; respect `meta.jsonInput: false` opt-out).
- [ ] In flags mode under global `jsonInput`, add the cosmetic `--json <json>` help-only option to leaf commands (skip opted-out procedures).
- [ ] Tests (new `test/json-input.test.ts`; copy/adapt from the `json-mode` branch where appropriate — malformed JSON, payload-goes-through-validation, variadic cases carry over with adjusted expectations):
  - [ ] `--json '{...}'` works as complete input for object, tuple-with-options, and positional-meta schemas
  - [ ] `--json` + another flag → unknown option error (replaces #199's conflicts test)
  - [ ] malformed JSON errors usefully
  - [ ] payload still validated by the procedure's schema (Zod issue surfaces in CliValidationError)
  - [ ] `--json='{...}'` equals-form activates JSON mode
  - [ ] literal `--json` after `--` terminator does NOT activate JSON mode
  - [ ] explicit `run({argv})` is sniffed, not `process.argv`
  - [ ] help in flags mode shows `--json` on leaf commands; JSON-mode help shows only `--json`
  - [ ] `meta.jsonInput: false` opt-out under global mode
  - [ ] `meta.jsonInput: true` procedures use `--json` (renamed from `--input`)
- [ ] README: rename `--input` references, document `createCli({jsonInput: true})`, note the v0 breaking change prominently.
- [ ] Type test: `TrpcCliParams` has `jsonInput?: boolean`.

## Open questions / assumptions (made unilaterally, flag in PR if controversial)

- Help-only `--json` is registered as a real (unreachable) Commander option rather than `addHelpText`, so it renders in the options table consistently. Assumed fine.
- `toJSON()`/`buildProgram()` without runParams build in flags mode (no argv to sniff) — cosmetic `--json` appears when global mode is on, which seems right for docs output.
- No `'only'`/`'also'` union values for now; `true` is the only switch. Hybrid-per-procedure can be added later non-breakingly.

## Reference

- Superseded approach: PR #199 (https://github.com/mmkal/trpc-cli/pull/199) — Commander subclass + conflicts wiring. Its review-round tests are the source for several specs above.
- Owner discussion: the argv-sniffing trick means "if `--json` is used it's the only allowed way; if it's not used it's not an allowed way", reducing the hybrid problem to help text.

## Implementation Notes

(log added during implementation)
