---
status: in-progress
size: medium
base: hoist-validation-issues (https://github.com/mmkal/trpc-cli/pull/222)
---

# Simplify argv value coercion now that the schema reports its own issues

**Status:** spec written, implementation not started.

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

- [ ] Remove the positional number `argParser` in `configureCommand`. The schema reports non-numbers instead.
- [ ] One `coerce(schema, value)` used for both positionals and options. Replaces `convertPositional`,
      `getOptionValueParser`, `numberParser`, `booleanParser`.
- [ ] `coerce` only throws for malformed JSON (when JSON is the only way to produce an accepted type). Everything else
      is coerced if possible, otherwise passed through as typed for the schema to reject.
- [ ] Collapse the string / number|integer / multi-type-union / untyped-json branches in `addOptionForProperty` into one
      "value option + coerce" branch. Boolean and array branches stay (arity differs). Enum branch stays (choices).
- [ ] Help text unchanged.
- [ ] Every snapshot change reviewed; behaviour changes listed in the PR body with before/after.

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
- If coercing a positional throws (malformed JSON, positional schema that accepts e.g. `number | null` only), it should
  still surface as a commander-style error against that argument, not a stack trace. Verify empirically.

## Implementation log
