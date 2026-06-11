---
status: ready
size: medium
---

# Unified JSON input: `--json` everywhere, argv-sniffing global mode

## Status Summary

Revision 3 implemented and green. `jsonInput` is a `'never' | 'auto' | 'always'` union at both levels (booleans throw a migration message), with `'never'` as the default - JSON input is opt-in via `createCli({jsonInput: 'auto'})` (sniffing hybrid) or `'always'` (JSON-only). The schema-wins guard and all `'auto'`/`'always'` behavior from Revision 2 are unchanged. Resolution lives in `resolveJsonInputMode` in src/index.ts; tests in test/json-input.test.ts; README/codegen reframed as opt-in; Revision 2's default-on snapshot churn reverted. Remaining: owner review of the PR (#204, kept as draft).

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

- [x] Change `TrpcCliParams.jsonInput` and `TrpcCliMeta.jsonInput` to the union type; export a `JsonInputMode` type alias; update jsdoc (README codegen follows). _done in src/types.ts; `JsonInputMode` exported alongside; type test in test/types.test.ts covers both levels_
- [x] Runtime rejection of booleans with helpful migration message. _`resolveJsonInputMode` in src/index.ts throws `jsonInput: true is no longer supported - use 'always'` (and the 'never' equivalent) at buildProgram time, checking both meta and params values_
- [x] Implement per-leaf mode resolution (meta > global > 'auto') and the schema-wins guard. _in configureCommand: 'always' → jsonProcedureInputs(); otherwise derive from schema and, for 'auto' leaves without a schema `json` option (checked via flattenedProperties + kebabCase), go JSON-only when `jsonFlagSniffed`_
- [x] Default-on behavior: cosmetic `--json` appears in help of all `'auto'` leaves by default (no `jsonInput` param needed); `'never'` removes it; schema-json leaves keep their own flag. _cosmetic option tagged `__cosmeticJsonOption` so prompts.ts skips prompting for it; also surfaces in toJSON() output_
- [x] Tests: update v1 tests for the union (no `jsonInput: true` in fixtures); add: default-on works with zero config; `'never'` globally disables; `'always'` globally = JSON-only everywhere; meta `'never'`/`'always'`/`'auto'` override global; schema-wins guard (json-named property command keeps its flag under sniffed argv, sibling commands go JSON-only); boolean rejection error message. Expect widespread snapshot updates: the cosmetic `--json` now appears in help output across the whole suite. _test/json-input.test.ts rewritten (17 tests); orpc/norpc fixtures moved to `'always'`; 19 snapshots updated across zod4/e2e/deep-help/help/lifecycle/json tests - commands with no schema options also gain `[options]` in subcommand lists_
- [x] README: rewrite the JSON input docs around default-on (headline: every CLI accepts `--json`), document the union + both breaking changes (`--input` rename, boolean removal). _new "JSON input" section ahead of "Complex Inputs with JSON", with a combined breaking-changes blockquote_
- [x] Update PR #204 body for the new design. _headline "every command accepts --json by default"; WARNING covers both breaking changes_

## Implementation Notes

- The renamed JSON option is `--json <json>` (value-required) rather than the old `--input [json]` (value-optional). Implemented by adding `required: ['json']` to the options JSON schema in `jsonProcedureInputs` - that flows through the existing option-building logic in index.ts and produces `<json>` brackets without making the option itself mandatory (so procedures with optional inputs can still be invoked with no arguments at all).
- Detection nuance discovered while reconciling two spec statements ("sniff process.argv when no explicit argv" vs "buildProgram() without runParams builds in flags mode"): `run()` now calls `buildProgram(runParams || {})`, so the run path always sniffs (explicit argv if provided, else process.argv minus the node/script prefix), while user-facing `buildProgram()`/`toJSON()` with no arguments build in flags mode.
- Commander checks missing mandatory options *before* unknown options, so an opted-out procedure with a required flag invoked with only `--json` errors with "required option ... not specified" rather than "unknown option '--json'". Both are failures, just a message-ordering quirk - the opt-out test uses an optional flag to assert the unknown-option message.
- The test-run.ts `expectJsonInput` heuristic now matches on the `Input formatted as JSON` description text instead of option flags, because the cosmetic `--json <json>` option (expected in flags-mode help under global jsonInput) has identical flags to the real JSON-only option.
- Edge case (tested): a schema property literally named `json`. ~~Under v1, passing `--json` always activated JSON mode, so the property could only be supplied through the JSON payload.~~ _superseded by the Revision 2 schema-wins guard: an `'auto'` leaf whose derived options include a `json` property is always built from its schema, so its `--json` flag keeps its schema meaning even when `--json` is sniffed in the argv (test: "schema wins: a procedure with its own json property keeps its schema-derived --json flag")._

### Revision 2 implementation log (2026-06-11)

- `resolveJsonInputMode(metaValue, paramsValue)` (src/index.ts) checks both values for booleans *before* resolving, so `meta: 'always'` + `params: true` still throws the migration message. Resolution is the idiomatic `metaValue || paramsValue || 'auto'`.
- The schema-wins check inspects `flattenedProperties(schemaDerived.optionsJsonSchema)` for a key whose `kebabCase` is `json`. This also matches the unparseable-schema fallback (whose options schema *is* a real `json` option), which neatly keeps that fallback as-is under every mode including `'never'` - no special-casing needed.
- The cosmetic help-only `--json` option is tagged with `__cosmeticJsonOption` and skipped in prompts.ts's shadow-command analysis - otherwise interactive prompting would ask users for "json" on every command that triggers prompts.
- Default-on knock-on effects in snapshots: every leaf gains the `--json <json>` help line, commands that previously had zero options now show `[options]` in parent help command lists, and `toJSON()` output includes the cosmetic option (flags-mode build). 19 snapshots updated deliberately.
- `getParsedProcedure` (src/parse-router.ts) now checks `meta.jsonInput === 'always'` instead of truthiness - `'never'`/`'auto'` are truthy strings and must not trigger the JSON-only build there.

## Revision 3 (2026-06-11): default back to 'never'

Owner decision: default-on gave every single command a boilerplate-y `--json <json>` line in its help output, which felt like too much noise as a default. The union, the schema-wins guard, boolean rejection, and all `'auto'`/`'always'` behavior stay exactly as Revision 2 built them - the ONLY semantic change is the unset-everywhere default: `meta.jsonInput || params.jsonInput || 'never'`. JSON input is opt-in again (`createCli({jsonInput: 'auto'})` for the sniffing hybrid, `'always'` for JSON-only).

### Revision 3 checklist

- [x] Flip the default in `resolveJsonInputMode` (src/index.ts) from `'auto'` to `'never'`. _one-line change in the resolution expression, plus the function's jsdoc_
- [x] Update jsdoc on both `jsonInput` params (src/types.ts) - default is `'never'`; regenerate README codegen. _`'never'` listed first as `(default)` on `TrpcCliParams.jsonInput`, `TrpcCliMeta.jsonInput` and the `JsonInputMode` alias; README's calculator codegen blocks regenerated via `eslint --fix README.md` (the API docs block codegens from `createCli`'s jsdoc, which doesn't mention jsonInput, so it was unaffected)_
- [x] Tests: the zero-config test now asserts NO `--json` (in help or as an accepted option); keep explicit `'auto'`/`'always'`/`'never'` and meta-override tests (they should be unaffected); revert the default-on snapshot churn across the suite (the 19 snapshots from Revision 2 mostly return to their pre-default-on state). _new "zero config: commands do not accept --json" test; the 'auto'-behavior tests (combination errors, malformed JSON, sniffing, help, schema-wins, default-command forwarding) now pass `jsonInput: 'auto'` explicitly via `runWith`; deep-help/help/lifecycle/zod4/e2e/json snapshots verified byte-identical to the pre-Revision-2 state (json.test.ts differs only in snapshot indentation)_
- [x] README: JSON input section reframed as opt-in (lead with `jsonInput: 'auto'` usage); breaking-changes blockquote keeps the rename + boolean-removal notes but drops the "all CLIs upgraded" framing. _sample now shows `createCli({router, jsonInput: 'auto'})`; dropped the "any trpc-cli CLI can be driven this way" clause; blockquote unchanged_
- [x] Update PR #204 body: headline back to opt-in, mode table unchanged otherwise. _via `gh pr edit 204`_
