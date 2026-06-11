---
status: ready
size: medium
---

# Unified JSON input: `--json` everywhere, argv-sniffing global mode

## Status Summary

Revision 2 in progress. The v1 implementation (boolean `jsonInput`, opt-in) is complete and green; Revision 2 below (decided with the owner 2026-06-11) changes the param to a `'never' | 'auto' | 'always'` union, makes `'auto'` the **default** (all CLIs gain `--json` support on upgrade), adds a per-leaf schema-wins guard, and drops boolean values entirely. See "Revision 2" section for the delta checklist.

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

- [x] Rename the JSON option in `jsonProcedureInputs` (`src/parse-router.ts`) from `input` to `json`, including `getPojoInput` and the description. Update all existing tests/snapshots that reference `--input` JSON fallback usage. _done - option key is now `json` and marked `required` so it renders `--json <json>`; snapshots updated in zod3/zod4/arktype/valibot/norpc/orpc tests; test-run.ts heuristic now matches on the "Input formatted as JSON" description since the flags collide with the cosmetic option_
- [x] Add `jsonInput?: boolean` to `TrpcCliParams` (`src/types.ts`) with a jsdoc explaining the global hybrid behavior. _done, also updated the `TrpcCliMeta.jsonInput` jsdoc to mention `--json` and the `false` opt-out_
- [x] Implement argv detection in `buildProgram` (`src/index.ts`) per the detection rule above, and thread "JSON mode active" into command construction (use `jsonProcedureInputs` for leaves; respect `meta.jsonInput: false` opt-out). _done via `argvIncludesJsonFlag` helper + `jsonModeActive` const in buildProgram; `run` now calls `buildProgram(runParams || {})` so direct `buildProgram()`/`toJSON()` calls stay in flags mode while `run()` sniffs process.argv_
- [x] In flags mode under global `jsonInput`, add the cosmetic `--json <json>` help-only option to leaf commands (skip opted-out procedures). _done in configureCommand; skipped when a `--json` option already exists (e.g. unparseable-schema fallback, or a schema property named `json`)_
- [x] Tests (new `test/json-input.test.ts`; copy/adapt from the `json-mode` branch where appropriate — malformed JSON, payload-goes-through-validation, variadic cases carry over with adjusted expectations):
  - [x] `--json '{...}'` works as complete input for object, tuple-with-options, and positional-meta schemas _first test in test/json-input.test.ts, includes deeply nested routers_
  - [x] `--json` + another flag → unknown option error (replaces #199's conflicts test) _`unknown option '--foo'`_
  - [x] malformed JSON errors usefully _commander InvalidOptionArgumentError with "Malformed JSON" hint_
  - [x] payload still validated by the procedure's schema (Zod issue surfaces in CliValidationError) _missing-required and wrong-type cases_
  - [x] `--json='{...}'` equals-form activates JSON mode
  - [x] literal `--json` after `--` terminator does NOT activate JSON mode _`--json` becomes a positional operand_
  - [x] explicit `run({argv})` is sniffed, not `process.argv` _sets process.argv to contain --json, runs explicit argv without it, asserts flags mode_
  - [x] help in flags mode shows `--json` on leaf commands; JSON-mode help shows only `--json` _via `--json '{}' --help`_
  - [x] `meta.jsonInput: false` opt-out under global mode _flags work, no --json in help, --json is unknown option; sibling procedure unaffected_
  - [x] `meta.jsonInput: true` procedures use `--json` (renamed from `--input`) _works without the global setting_
- [x] README: rename `--input` references, document `createCli({jsonInput: true})`, note the v0 breaking change prominently. _new "Global JSON input" subsection under "Complex Inputs with JSON", with a rename note blockquote; remaining `--input` mentions in validators sections renamed_
- [x] Type test: `TrpcCliParams` has `jsonInput?: boolean`. _added to test/types.test.ts_

## Open questions / assumptions (made unilaterally, flag in PR if controversial)

- Help-only `--json` is registered as a real (unreachable) Commander option rather than `addHelpText`, so it renders in the options table consistently. Assumed fine.
- `toJSON()`/`buildProgram()` without runParams build in flags mode (no argv to sniff) — cosmetic `--json` appears when global mode is on, which seems right for docs output.
- No `'only'`/`'also'` union values for now; `true` is the only switch. Hybrid-per-procedure can be added later non-breakingly.

## Reference

- Superseded approach: PR #199 (https://github.com/mmkal/trpc-cli/pull/199) — Commander subclass + conflicts wiring. Its review-round tests are the source for several specs above.
- Owner discussion: the argv-sniffing trick means "if `--json` is used it's the only allowed way; if it's not used it's not an allowed way", reducing the hybrid problem to help text.

## Revision 2 (2026-06-11): union modes, default-on, schema-wins

Owner decisions after reviewing the v1 design:

- `jsonInput?: 'never' | 'auto' | 'always'` — same union accepted at BOTH levels (`TrpcCliParams` and `TrpcCliMeta`). **No booleans anywhere** (breaking for existing `meta.jsonInput: true` users → they write `'always'`; `false` → `'never'`). Add a build-time runtime check that throws a helpful message if a boolean is passed (e.g. `jsonInput: true is no longer supported - use 'always'`).
- **Default is `'auto'`** when unset at both levels. Every trpc-cli CLI accepts `--json` out of the box after upgrading. This is the headline feature: agents/scripts can rely on `--json` working on any trpc-cli CLI.
- Resolution per leaf: `mode = meta.jsonInput || params.jsonInput || 'auto'` (meta overrides global). `'auto'` is *secretly `'always'` with a pre-parse*: sniff argv once per invocation (existing `argvIncludesJsonFlag` rule); effective mode for an `'auto'` leaf is `'always'` when sniffed, else `'never'`-plus-cosmetic-help-option.
- **Schema-wins guard** (applies to `'auto'` leaves only): if a leaf's derived options already include a `json` property, the schema wins — build normally even when `--json` was sniffed, no cosmetic help option, the user's own `--json` flag keeps its schema meaning. This makes default-on strictly additive for existing CLIs: the only observable change is "unknown option --json" errors becoming working JSON input. Explicit `'always'` needs no guard (no derived flags exist, a `json` property just lives in the payload).
- Unparseable-schema fallback stays as-is (effectively `'always'`).
- v1's "no `'only'`/`'also'` union values" assumption is superseded by this revision.

### Revision 2 checklist

- [ ] Change `TrpcCliParams.jsonInput` and `TrpcCliMeta.jsonInput` to the union type; export a `JsonInputMode` type alias; update jsdoc (README codegen follows).
- [ ] Runtime rejection of booleans with helpful migration message.
- [ ] Implement per-leaf mode resolution (meta > global > 'auto') and the schema-wins guard.
- [ ] Default-on behavior: cosmetic `--json` appears in help of all `'auto'` leaves by default (no `jsonInput` param needed); `'never'` removes it; schema-json leaves keep their own flag.
- [ ] Tests: update v1 tests for the union (no `jsonInput: true` in fixtures); add: default-on works with zero config; `'never'` globally disables; `'always'` globally = JSON-only everywhere; meta `'never'`/`'always'`/`'auto'` override global; schema-wins guard (json-named property command keeps its flag under sniffed argv, sibling commands go JSON-only); boolean rejection error message. Expect widespread snapshot updates: the cosmetic `--json` now appears in help output across the whole suite.
- [ ] README: rewrite the JSON input docs around default-on (headline: every CLI accepts `--json`), document the union + both breaking changes (`--input` rename, boolean removal).
- [ ] Update PR #204 body for the new design.

## Implementation Notes

- The renamed JSON option is `--json <json>` (value-required) rather than the old `--input [json]` (value-optional). Implemented by adding `required: ['json']` to the options JSON schema in `jsonProcedureInputs` - that flows through the existing option-building logic in index.ts and produces `<json>` brackets without making the option itself mandatory (so procedures with optional inputs can still be invoked with no arguments at all).
- Detection nuance discovered while reconciling two spec statements ("sniff process.argv when no explicit argv" vs "buildProgram() without runParams builds in flags mode"): `run()` now calls `buildProgram(runParams || {})`, so the run path always sniffs (explicit argv if provided, else process.argv minus the node/script prefix), while user-facing `buildProgram()`/`toJSON()` with no arguments build in flags mode.
- Commander checks missing mandatory options *before* unknown options, so an opted-out procedure with a required flag invoked with only `--json` errors with "required option ... not specified" rather than "unknown option '--json'". Both are failures, just a message-ordering quirk - the opt-out test uses an optional flag to assert the unknown-option message.
- The test-run.ts `expectJsonInput` heuristic now matches on the `Input formatted as JSON` description text instead of option flags, because the cosmetic `--json <json>` option (expected in flags-mode help under global jsonInput) has identical flags to the real JSON-only option.
- Edge case (tested): a schema property literally named `json` under global jsonInput - passing `--json` always activates JSON mode, so the property can only be supplied through the JSON payload. In flags mode the schema-derived `--json <string>` option is shown in help (the cosmetic option is skipped to avoid a duplicate registration); it's unreachable as a flag. Deemed acceptable for an edge case, flagged here for review.
