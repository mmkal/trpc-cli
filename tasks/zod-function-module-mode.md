---
status: in-progress
size: medium
---

# Module mode from `z.function()` exports

**Status:** spec written, implementation in progress.

Module mode (`createCli(import.meta)`) currently derives each command's input schema by parsing the module's
*source text* with the vendored/patched typebox `Type.Script`. That's neat but lossy: no runtime transforms,
no custom metadata, and a hand-rolled TS extractor that has to keep up with syntax.

zod's `.implement()` now attaches the function schema to the returned function
(colinhacks/zod#6104 → colinhacks/zod#6267, on npm as `4.5.0-canary.*`), so a module can be written as:

```ts
import {z} from 'zod'

/** greet someone */
export const sayHello = z
  .function({input: [z.string().describe('name'), z.object({enthusiasm: z.number().int().positive()}).optional()]})
  .implement((name, options) => `Hello, ${name}${'!'.repeat(options?.enthusiasm || 0)}`)

void createCli(import.meta).run()
```

and trpc-cli can read `sayHello._zod.def.input` (a `ZodTuple`) instead of parsing anything.

## Decisions

- Detection is per module file, on the *live exports*: if every function-valued export carries `_zod` with
  `def.type === 'function'`, the module is a "zod-function module" and the typebox flow (source extractor,
  declaration context, `Type.Script`) is skipped entirely.
- Mixing zod functions with plain functions/classes in one file throws an error naming both groups. Silently
  ignoring one side is worse; split them into separate files and re-export if needed.
- Exports that are identical to a re-exported child's exports (`export * from './child'`) are not counted as
  local, so re-export composition keeps working in file mode.
- Input mapping reuses the existing tuple convention: `_zod.def.input` is passed straight to `.input(...)`,
  so leading scalars become positionals and a trailing object becomes flags. Empty tuple / no `input` → no
  CLI inputs. Rest args (`z.function({input: z.array(...)})` or tuple rest) throw - unsupported for now.
- Command descriptions and `@alias` come from the jsdoc immediately before `export const <name>`, same as the
  typebox flow (`z.function().describe()` metadata lives in zod's registry keyed by the schema instance, which
  `_zod` doesn't point back to). Source order determines command order.
- `export default` zod functions aren't supported (the implemented function has no usable name) - throws.
- Pre-existing tuple gap fixed generically in parse-procedure: an *optional* trailing flags object (zod
  encodes this as `minItems` below the flags index) no longer makes its required properties required at the
  CLI level, and the handler receives `undefined` instead of `{}` when no flags were given. The typebox module
  flow always passes a flags object, so it now sets `minItems` accordingly and is unaffected.

## Checklist

- [ ] bump `zod` devDependency to a canary containing colinhacks/zod#6267
- [ ] detect zod-function modules in `buildRouterFromModule` / `buildRouterFromFileModule`
- [ ] build procedures from `_zod.def.input`, with jsdoc descriptions + aliases and source order
- [ ] optional trailing flags object handling in `parseTupleInput`
- [ ] tests: help, positionals + flags, optional options object omitted, validation errors, mixed-module error, re-export composition, `{source, exports}` escape hatch
- [ ] README section under module mode

## Implementation log
