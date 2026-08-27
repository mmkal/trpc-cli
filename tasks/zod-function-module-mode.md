---
status: review
size: medium
---

# Module mode from `z.function()` exports

**Status:** implemented, tests + README done. Blocked on a stable zod release for the peer range (currently pinned to a canary dev dep).

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

- [x] bump `zod` devDependency to a canary containing colinhacks/zod#6267 _`4.5.0-canary.20260827T054049`; it was previously only pulled in as an auto-installed peer_
- [x] detect zod-function modules in `buildRouterFromModule` / `buildRouterFromFileModule` _`detectZodFunctionModule` in src/module-commands.ts; file mode loads re-export children first so their values can be excluded_
- [x] build procedures from `_zod.def.input`, with jsdoc descriptions + aliases and source order _`buildZodFunctionProcedures`/`buildZodFunctionProcedure`_
- [x] optional trailing flags object handling in `parseTupleInput` _`flagsOptional` in src/parse-procedure.ts; typebox module flow now sets `minItems` so it's unaffected_
- [x] tests _test/zod-function-module-commands.test.ts + fixtures; router-mode case in test/zod4.test.ts (above the codegen marker)_
- [x] README section under module mode _"Module mode with zod functions"_
- [ ] once zod ships `_zod` on `.implement()` in a stable release, note the minimum version in the README and drop the canary pin

## Implementation log

- The `{source, exports}` escape hatch treated `source: ''` as "not module mode" (`source ? ...`). Fixed to `typeof source === 'string'` in src/index.ts - zod function modules don't need any source.
- Zod's `_zod` on the implemented function is the *schema's* internals (`inst._zod`), not the schema, so `.describe()` on the function schema (stored in `z.globalRegistry` keyed by instance) is unreachable. Hence jsdoc for command descriptions.
- `z.function()` without `input` defaults to `z.array(z.unknown())` - treated as "no arguments" rather than an unsupported array input.

## Implementation log
