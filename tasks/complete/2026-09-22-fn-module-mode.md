---
status: done
size: medium
---

# `fn()`: a `z.function()`-shaped builder for any Standard Schema

**Status:** done. `fn()` exported from the package, module mode builds commands from it directly, `z.function()` is now an adapter onto the same path, tests + README written.

Follow-up to the `z.function()` module-mode work (2026-09-22-zod-function-module-mode.md). That work kept hitting
zod's limits: the implemented function hides its callback (so positional names had to be scraped from the
`.implement(` source text), `.describe()`/`.meta()` on the function schema are unreachable from the implemented
function (so descriptions had to come from jsdoc), and it's zod-only. Asking zod maintainers for each of these is
slow, so trpc-cli gets its own builder with the same shape:

```ts
import {fn} from 'trpc-cli'

export const sayHello = fn({input: [z.string(), z.object({shout: z.boolean()}).optional()]})
  .describe('greet someone')
  .meta({aliases: {command: ['hi']}})
  .implement((name, options) => `hello ${name}`)
```

## Decisions

- Drop-in for `z.function()`'s `fn({input}).describe().meta().implement()` surface; the key is `input`, matching zod.
  Items are any Standard Schema. `output` validates the result on direct calls.
- `.implement()` returns a plain callable that validates through the schemas (sync unless a schema validates
  asynchronously) and carries a non-enumerable definition under `Symbol.for('trpc-cli.fn')`: `{input, output,
  meta, implementation}`. Positional names come from `implementation.toString()`, so nothing is scraped from the
  file. `.meta()` takes the existing `TrpcCliMeta`.
- `fn` is the main thing in module mode: `fn` exports and zod-function exports both become a `CommandFunction`
  (`{input, meta, paramNames, call}`) and share one procedure builder. The zod adapter is the only place that
  still reads the `.implement(` source text (zod keeps the callback private).
- Item schemas are converted to JSON schema individually and assembled into a tuple schema (with `title`s from the
  parameter names) that validates via the original schemas. This replaced the ZodTuple-specific wrapper; the
  zod tests pass unchanged through the adapter.
- Source is still consulted for the export declaration, for both kinds: position (ESM namespace keys are
  alphabetical, and plain functions are ordered by source position) and whether the export is declared in this
  file (excludes `export * from './child'` values), plus jsdoc description/`@alias` as a fallback when `.meta()`
  doesn't set them.
- `src/fn.ts` imports only the standard-schema contract/errors and types, since command modules import it.

## Checklist

- [x] `fn()` builder + `FnImplemented` marker in src/fn.ts, exported from src/index.ts _also `isFnImplemented`, `FnBuilder`, `FnDefinition` types_
- [x] shared tuple validator _`validateTuple` in src/standard-schema/tuple.ts, used by `fn` direct calls and by the assembled tuple schema's `~standard`_
- [x] unified `CommandFunction` + `buildCommandFunctionProcedure` in src/module-commands.ts; zod adapted via `zodFunctionCommand` _net: `withParameterNames`/`buildZodFunctionProcedure` gone_
- [x] parameter names from `Function.prototype.toString` _`parseFunctionParamNames`, shared with the zod source-scan path_
- [x] tests _test/fn-module-commands.test.ts + test/fixtures/fn-module.ts (zod + valibot items, plain and zod functions mixed in)_
- [x] README _"Module mode with `fn()`" section; the zod section is now framed as the compatibility path_
