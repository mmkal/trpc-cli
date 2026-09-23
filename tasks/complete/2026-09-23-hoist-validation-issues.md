---
status: done
size: medium
---

# Hoist schema validation issues to the CLI argument/option level

**Status:** done. All three router flavours (tRPC, oRPC, norpc/module mode) report schema issues against the argument or option they came from; 46 existing snapshots updated, new tests + fixture added, README section written.

## Problem

A module like this:

```ts
export const checkHealth = z
  .function({
    input: [z.url().refine(url => url.startsWith('https://'), 'secure only pls')],
  })
  .implement(async url => ({status: 200, url}))
```

run as `npx trpc-cli myfile.ts check-health 'http://example.com'` currently prints a raw stack trace:

```
Error: Invalid input: ✖ secure only pls → at [0]
    at Object.call (src/norpc.ts:30:15)
    ...
```

`[0]` is an index into a tuple the user never sees. Standard Schema issues carry `path`s, and trpc-cli is the
thing that decided path `[0]` means "the `url` positional argument", so it can map the path back and report the
issue the way commander reports its own parse failures:

```
error: command-argument value 'http://example.com' is invalid for argument 'url'. secure only pls
```

## Investigation findings

- **Module mode vs router mode differ today, but only in the plumbing.** Module mode (and `t`/`os` from
  `trpc-cli/norpc`) builds norpc procedures whose `call` throws a plain `Error('Invalid input: ...')`. That's
  neither a `TRPCError` nor an `ORPCError`, so `transformError` in `src/index.ts` ignores it and the raw error
  (with stack) is printed. tRPC and oRPC wrap failures as `TRPCError`/`ORPCError` with `code: 'BAD_REQUEST'` and a
  `cause` carrying Standard Schema `issues`, which `transformError` prettifies (`✖ message → at path` + help).
- **It doesn't need to differ.** If norpc's `call` throws an error with the same shape (`code: 'BAD_REQUEST'`,
  `cause` = the Standard Schema failure result), one code path serves all three. So both modes ship together.
- **Input-parse errors vs `z.string().parse()` inside a handler**: gate on `code === 'BAD_REQUEST'`. tRPC wraps
  errors thrown inside a resolver as `INTERNAL_SERVER_ERROR`; oRPC lets them propagate unwrapped; norpc will only
  tag the validate step. Verified in a probe: today a `ZodError` thrown *inside* a tRPC resolver is misreported
  as a CLI validation error (prettified + help text) because `transformError` checks for `issues` on the cause
  without checking the code. This work fixes that as a side effect.
- **`--json` mode** already routes the whole input through one option, so paths map naturally to
  `option '--json <json>' ... → at count`.

## Decisions

- `ParsedProcedure` gains `getArgvLocation(path)`: the inverse of `getPojoInput`. Each parser variant in
  `src/parse-procedure.ts` (primitive, tuple, array, object, merged multi-input, positional-ish properties) and the
  JSON fallback in `src/parse-router.ts` implements it. Returns `{type: 'positional', index, path}` or
  `{type: 'option', key, path}` (with the remaining path inside that argument/option) or `undefined` when the path
  doesn't land on anything the CLI exposes (e.g. a root-level `.refine()` on an object input).
- Message wording mirrors commander's `InvalidArgumentError` output so schema issues read like built-in parse
  errors (`error: ` prefix, no `✖`):
  - positional: `error: command-argument value 'http://example.com' is invalid for argument 'url'. secure only pls`
  - option: `error: option '--enthusiasm <number>' argument '-1' is invalid. Too small: expected number to be >0`
  - remaining path inside an option value keeps the existing suffix: `... argument '{"abc":"abc"}' is invalid. Invalid input: expected number, received undefined → at def`
  - index segments select the repeated token (`--foo a --foo wrong` → `argument 'wrong'`; variadic positionals
    likewise); key segments stay in the `→ at` suffix, since they identify a part of one typed value.
  - when the located value is `undefined` (e.g. a missing optional-flags-object property that the schema requires),
    the `argument '...'` clause is dropped: `error: option '--count <number>' is invalid. Invalid input: expected number, received undefined`
  - values render as the string the user typed where we have it; non-strings (parsed numbers/booleans, JSON
    options) as compact JSON.
  - unmappable issues fall back to the current `✖ message → at path` line.
  - one line per issue, then the existing blank line + help text.
- Argument and option names come from the commander `Command` itself (`registeredArguments[index].name()`,
  `options` matched by `attributeName()`), so what's printed matches what `--help` shows.
- norpc's `call` throws `InputValidationError` (new, `src/errors.ts`): `code: 'BAD_REQUEST'`, `cause` = the failure
  result, message keeps the prettified issues so direct callers of `.call()` still get a readable error.
- ~~`transformError` duck-types on `code === 'BAD_REQUEST'` + a cause with `issues`, rather than on
  `TRPCError`/`ORPCError` class names, so norpc, tRPC and oRPC share it.~~ _Tightened after review: a bare
  `code: 'BAD_REQUEST'` check let a handler's `throw Object.assign(new Error(), {code: 'BAD_REQUEST', cause: zodError})`
  masquerade as bad CLI input. Now per framework: norpc via `instanceof InputValidationError` (not exported); oRPC via
  `ORPCError` + `ValidationError` cause whose `data` is the exact input object passed in (handlers only see the parsed
  value); tRPC via `TRPCError` + `BAD_REQUEST`, since its input middleware throws a bare `new TRPCError({code, cause})`
  identical to what a resolver could throw - a resolver doing that is explicitly saying "bad input", and the only
  airtight alternative (pre-validating before calling) runs refinements/transforms twice._ The arktype/valibot special
  cases stay.

## Checklist

- [x] `getArgvLocation` on `ParsedProcedure` + implementations for every variant _`src/parse-procedure.ts` (7 sites + `optionLocation` helper), `src/parse-router.ts` (JSON fallback), type in `src/types.ts`_
- [x] norpc `call` throws `InputValidationError` with `code: 'BAD_REQUEST'` and the failure as `cause` _`src/errors.ts`, `src/norpc.ts`_
- [x] `transformError` maps issues → argument/option messages; gated on `BAD_REQUEST` _`describeIssues` in `src/index.ts`; the action passes `{command, parsedProcedure, positionalValues, options}`_
- [x] fixture + tests _`test/validation-issues.test.ts` (tRPC/oRPC/norpc, positional-meta, root refine fallback, in-handler ZodError, `--json` mode); `checkHealth` export in `test/fixtures/zod-function-module.ts` + test in `test/zod-function-module-commands.test.ts`_
- [x] update existing snapshots _46 across 13 files, all reviewed - every one is the same issue re-attributed to its argument/option_
- [x] README: validation error section _new "Validation errors" subsection under "Combining Positional Arguments and Options"; stale zod3-era snippet in "Testing your CLI" corrected_

## Implementation log

- Pre-existing bug fixed in passing: number options (`--bar <number>`) parsed a non-numeric value to `null`, which
  commander turns into `''`, so the schema saw an empty string and the user's typed value was lost. The option
  parser now passes the raw string through (as the positional parser and the comment already claimed), so the error
  reads `argument 'notanumber' is invalid` instead of `argument ''`.
- The in-handler `ZodError` misattribution was real for tRPC: `transformError` used to prettify any `TRPCError`
  whose cause had `issues`, including `INTERNAL_SERVER_ERROR` wrappers. Now only `BAD_REQUEST` qualifies; tRPC's
  INTERNAL_SERVER_ERROR still unwraps to its cause.
- Not done here: the `fn()` builder on the `fn-module-mode` branch (#221) builds the same tuple-shaped norpc
  procedures, so it picks this up on merge with no extra work beyond its own snapshot updates.

