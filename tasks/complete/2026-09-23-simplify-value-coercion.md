---
status: review
size: medium
base: hoist-validation-issues (https://github.com/mmkal/trpc-cli/pull/222)
---

# Simplify argv value coercion now that the schema reports its own issues

**Status:** done. One `coerce` in src/parse-procedure.ts serves positionals and options; the positional number
pre-check and both old coercers are gone (src net -104 lines). All tests pass; new test/coercion.test.ts pins the
behaviour changes. One follow-up noted below, not done here.

## Background

#222 reports Standard Schema issues against the argument/option that produced them, worded like commander's own
parse errors:

```
error: command-argument value 'x' is invalid for argument 'url'. secure only pls
error: option '--timeout [integer]' argument '0' is invalid. Too small: expected number to be >0
```

So trpc-cli's own pre-schema *validation* of argv strings is redundant. What's still needed:

- **coercion**: `z.number()` rejects `"3"`, so strings must become numbers/booleans/JSON before the schema sees them
- working out the target type from the JSON schema (unions, enums, nullables)
- choosing the commander shape (boolean optional-value + `--no-` negation, variadic arrays, mandatory `<value>`)
- `option.choices(...)` - help text, completions and prompts read them

Today there are two coercers that disagree:

- `convertPositional` (src/parse-procedure.ts) - positionals. Uses `acceptedPrimitiveTypes`. Non-integer for an
  integer schema stays a string. Has a dead branch (`acceptedTypes === undefined`).
- `getOptionValueParser` + `numberParser` + `booleanParser` (src/index.ts) - options. Uses `getSchemaTypes`. Throws
  `Got X but expected Y` on type mismatches. Any non-primitive type in a union (object, array, null) switches to
  strict JSON, so `--name foo` for `z.string().nullable()` is "Malformed JSON".

Plus a positional `argParser` for numbers that throws `Invalid number: x`, pre-empting the schema, then returns the raw
string anyway.

## Goals

- [x] Remove the positional number `argParser` in `configureCommand`. The schema reports non-numbers instead. _23 snapshots moved from "Invalid number: x" to the schema's message_
- [x] One `coerce(schema, value)` used for both positionals and options. Replaces `convertPositional`,
      `getOptionValueParser`, `numberParser`, `booleanParser`. _`coerce` + `coercePositional` in src/parse-procedure.ts_
- [x] `coerce` only throws for malformed JSON (when JSON is the only way to produce an accepted type). Everything else
      is coerced if possible, otherwise passed through as typed for the schema to reject. _narrowed to "accepts object/array and not string", see log_
- [x] Collapse the string / number|integer / multi-type-union / untyped-json branches in `addOptionForProperty` into one
      "value option + coerce" branch. Boolean and array branches stay (arity differs). ~~Enum branch stays (choices).~~ _enum folded in too: it only differed by the value name and `choices`_
- [x] Help text unchanged. _no help snapshot moved_
- [x] Every snapshot change reviewed; behaviour changes listed in the PR body with before/after.

## `coerce` semantics (decided)

Given the schema's types (`getSchemaTypes`) and the raw string:

1. `boolean` accepted and value is `true`/`false` -> boolean
2. value is numeric (`Number(value)`, but empty/whitespace is *not* numeric):
   - `number` accepted -> number
   - `integer` accepted and value is an integer -> number
   - `integer` accepted, value is a non-integer, `string` not accepted -> number (schema says "expected int" rather than
     "expected number, received string")
3. untyped schema, or a non-primitive type (object/array/null) accepted -> try `JSON.parse`:
   - parsed, and its type is accepted (or no type constraint, or strings aren't an option) -> parsed value
   - malformed, and `string` not accepted -> throw "Malformed JSON." (the string-quoting hint only for untyped schemas,
     where a JSON string is a valid input)
   - otherwise fall through
4. raw string

Why keep the malformed-JSON throw: passing `{foo: 1,}` through would degrade "Malformed JSON" into "expected object,
received string", which hides the actual mistake.

Why the "parsed type is accepted" check stays (as a fallback, not a throw): for `z.string().nullable()`, `123` should
stay the string `"123"` rather than become the number `123` and fail.

## Assumptions (made AFK - check these)

- Behaviour changes that make previously-rejected input work are fine (e.g. `--name foo` for a nullable string option,
  `--foo abc123` for a `boolean|number|string|object` union - previously "Malformed JSON", now the string).
- Empty string no longer coerces to `0` for number options/positionals (`Number('') === 0` was an accident). Schema
  gets `""` and rejects it.
- Positionals whose schema accepts a non-primitive (e.g. `string | object`) now get JSON-looking values parsed, same as
  options. Rare in practice.
- ~~If coercing a positional throws, it should still surface as a commander-style error against that argument.~~
  _Verified: it didn't (bare "Malformed JSON." with no argument). Positionals are coerced in `getPojoInput`, after
  commander, so `coercePositional` passes malformed JSON through for the schema to reject instead._

## Implementation log

- Two coercers merged. Differences resolved:
  - integers: non-integer for an integer-only schema -> number (schema says "expected int, received number"), both
    places. Positionals used to keep the string ("expected number, received string").
  - `string | number` with `007` -> `7` in both, same as before (number is checked first).
  - empty string no longer becomes `0`.
- First cut threw "Malformed JSON" for any union containing a non-primitive type, including `null`. The probe showed
  `z.number().nullable()` positional + `abc` then gave a bare "Malformed JSON." Narrowed the throw to schemas that
  accept object/array but not string; `null` just gets `JSON.parse`d when the value is valid JSON.
- `positional: true` meta arrays reach `getPojoInput` as `string[]`. The old coercer returned them untouched (its type
  set was empty), so `z.number().array().meta({positional: true})` got strings. Now items are coerced. Test added
  in zod4.test.ts "complex positionals".
- typebox `Type.Union([X, Type.Undefined()])` reports `undefined` as a type; `coerce` ignores it, otherwise optional
  tuple elements would switch to JSON mode.
- Untyped options (`--json <json>`) keep `<json>` without `makeOptionMandatory`: `jsonProcedureInputs` always marks
  `json` required, but the procedure input itself may be optional.
- Conflicts (`option.conflicts`) now apply to every option, not just string/number/array. Before, enum, union and
  boolean options showed "Do not use with" in help but weren't enforced by commander.
- Merged #222's follow-up (arktype under tRPC, typebox numeric path segments). The 5 arktype/typebox snapshots that
  had lost the argument name when the `Invalid number` pre-check went now name it again, e.g.
  `command-argument value 'banana' is invalid for argument 'right'. must be number`.

### Follow-ups (not done here)

- `--name null` for `z.string().nullable()` gives `true`: commander turns an `argParser` return of `null` into `true`
  for optional-value options. Pre-existing.
