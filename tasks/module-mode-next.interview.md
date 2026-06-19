# module-mode-next Grill Interview

## Setup Note — local claude auth failure — 2026-06-19

The literal `claude --print` path from the `grill-you` skill failed with `401 Invalid authentication credentials` before producing a question. The interview continued via the platform multi-agent tool with the same dossier.

---

## Q1 — type support boundary — 2026-06-19

Codebase answer: same-file `interface extends`, multiple `extends`, and object intersections already work through `Type.Script` plus local declaration context. Imported type references still fail loudly, by design.

**Question 1:** Should the proposal explicitly define module-mode type support as “same-file, `Type.Script`-parseable declarations only,” rather than trying to add TypeScript compiler/imported-type resolution?

**Recommended answer:** Yes. Document that module mode supports inline types, same-file `type`/`interface`, interface `extends`, object intersections, unions of object options, and first-overload signature extraction. Imported types, complex generics, and unparseable declarations should remain startup errors. Users who need richer imported schemas should opt into explicit procedure/schema exports instead of expecting plain-function scanning to become a compiler.

## A1 — 2026-06-19

Yes. Keep the plain-function scanner deliberately bounded to same-file, Type.Script-parseable declarations. The proposal should distinguish "already supported and should be documented" from "not a goal for plain function scanning".

Specific current support to document: inline parameter types, same-file type aliases/interfaces, interface extends including multiple bases, object intersections flattened into flags, union-of-object option shapes, scalar/literal-union positionals, and first overload signature extraction.

Imported types, arbitrary compiler resolution, type-annotated const function aliases, complex generics beyond what Type.Script can parse, and declarations that depend on external type context should keep failing loudly. [guess: this matches the owner's preference for loud startup errors and small pragmatic mechanisms over building a compiler.] The escape hatch for richer typing should be explicit runtime schema/procedure exports.

---

## Q2 — aliases in plain-function module mode — 2026-06-19

Codebase answer: aliases already exist for router/procedure mode through `meta.aliases.command` and `meta.aliases.options`, plus schema-level property `alias`. Plain-function module mode only reads function JSDoc as descriptions and type syntax as schemas; it has no metadata channel.

**Question 2:** Should plain-function module mode get aliases through JSDoc tags, or should aliases require opting into explicit procedure/schema exports?

**Recommended answer:** Use JSDoc tags for the bounded plain-function case, and keep explicit procedures as the richer escape hatch. Proposed syntax:

```ts
/**
 * install deps
 * @alias i
 * @alias add
 */
export function install(options: {
  /** fail if lockfile changed
   * @alias f
   */
  frozenLockfile?: boolean
}) {}
```

Rules: `@alias` above a command becomes `meta.aliases.command`; `@alias` on an option property becomes the option alias; aliases validate against the derived command/options and fail at startup on typos/conflicts. Do not add wrapper helpers or static metadata properties for plain functions, because those make the zero-boilerplate surface more magical than necessary and overlap with explicit procedure exports.

## A2 — 2026-06-19

Yes, use JSDoc tags for aliases in the plain-function surface.

Rules I want in the proposal:

- Command JSDoc supports repeated `@alias <name>` tags, mapped to `meta.aliases.command`.
- Option/property JSDoc supports one `@alias <name>` tag, mapped onto the property schema's existing `alias` field or equivalent `meta.aliases.options` path.
- Alias tags should be stripped from help descriptions so `--help` stays prose, not raw metadata.
- Invalid aliases should fail at startup or command build with the same strictness as existing alias meta. For property aliases, reuse existing invalid-option-alias checks where possible.
- Do not invent wrapper helpers or static side-channel metadata for plain functions in this proposal. If someone needs richer command metadata, explicit procedure exports should cover that path.

[guess: JSDoc is the least-bad metadata channel because module mode already treats source comments as user-facing CLI docs, and aliases are CLI docs/ergonomics rather than runtime behavior.]

---

## Q3 — overload semantics — 2026-06-19

Codebase answer: overloads already work by taking the first overload signature and ignoring later signatures plus the implementation. Tests pin this for object options and multi-parameter positionals.

**Question 3:** Should the proposal keep overload handling exactly as “first overload signature is the CLI contract,” including failing if that first signature is unparseable, rather than merging overloads or adding selection metadata?

**Recommended answer:** Yes. Document it as intentional. A CLI command has one help shape and one validation schema; merging overloads would either reject valid runtime calls or advertise combinations no overload actually accepts. If users want a different CLI shape, they should reorder overloads, export a wrapper function with the desired signature, or use an explicit procedure/schema export.

## A3 — 2026-06-19

Yes. Keep first overload signature as the CLI contract and document it as intentional current behavior.

No overload merging, no `@cliOverload`, no selection metadata in this proposal. If the first signature cannot be parsed, fail loudly. If a user wants a different command shape, they can reorder overloads, export a CLI-specific wrapper with a plain parseable signature, or export an explicit schema/procedure command.

[guess: avoiding overload merging is important because Commander help/validation needs one concrete public invocation shape, and trpc-cli should not pretend a TypeScript overload set is one CLI grammar.]

---

## Q4 — same-file subcommands and class exports — 2026-06-19

Codebase answer: today `export class Whatever {}` fails as an unmatched exported function because classes are `typeof value === 'function'` at runtime, but the scanner only recognizes exported function declarations/arrow consts. Same-file nested plain-function groups are not supported; nested commands currently come from `export * as group from './child'` or from router/procedure trees.

**Question 4:** Should same-file subcommand grouping use exported classes, or should the proposal reject classes and prefer object/router-shaped exports?

**Recommended answer:** Reject class exports as plain-function subcommands for this proposal. Classes create too many hidden policy choices: static vs instance methods, constructor arguments, per-invocation lifecycle, inherited methods, private state, and whether class export names are commands or dependency containers. Keep `export class` failing loudly unless it is part of an explicit procedure/router export path later.

For same-file grouping, prefer explicit runtime grouping in Phase 2:

```ts
export const users = {
  invite(options: {email: string}) {},
  deactivate(options: {id: string}) {},
}
```

That would map to `mycli users invite`, but only if the proposal accepts extending the source scanner to parse exported object-literal methods with the same plain-function rules. For richer cases, users should use `export const users = t.router({...})` or file-backed `export * as users from './users.ts'`.

## A4 — 2026-06-19

Reject class exports for this proposal. Keep `export class Whatever {}` as an actionable startup error, not a subcommand source.

The same-file grouping proposal should be exported object literals of command functions/methods:

```ts
export const users = {
  /** invite a user */
  invite(options: {email: string}) {},
  async deactivate(options: {id: string}) {},
}
```

That should map to `mycli users invite` and `mycli users deactivate`, using the same plain-function extraction rules for method JSDoc, parameter parsing, aliases, overload policy where applicable, and validation. Keep file-backed `export * as users from './users.ts'` as the preferred way to split larger groups across files.

For richer grouping, support explicit runtime routers/procedures: `export const users = t.router({...})` or ORPC/trpc router-shaped values if practical. Do not instantiate classes, do not inspect prototype methods, do not support constructor injection, and do not try to infer lifecycle from classes. [guess: class syntax looks attractive but would create too many unspoken runtime policies for a feature whose selling point is obvious function-to-command mapping.]

---

## Q5 — explicit schema/procedure exports — 2026-06-19

Codebase answer: module mode currently builds one norpc router from source-scanned plain functions. Router mode can parse tRPC routers, oRPC routers, and norpc routers, but `parseRouter` chooses one router kind at the root; it does not support a mixed tree containing norpc procedures beside oRPC/tRPC procedures. Exported norpc procedures are runtime objects, so module mode currently ignores them and may end with “No commands found.”

**Question 5:** For explicit schema/procedure exports in module mode, should Phase 2 support only `trpc-cli`’s own `t`/`os` norpc procedures and routers first, leaving exported tRPC/oRPC procedures/routers as later work?

**Recommended answer:** Yes. Start with norpc because it is already the internal representation module mode generates, uses `TrpcCliMeta` directly, and can mix naturally with plain functions in one norpc router:

```ts
export function plain(options: {name: string}) {}

export const explicit = os
  .input(z.object({name: z.string()}))
  .meta({aliases: {command: ['x']}})
  .handler(({input}) => input.name)

export const users = os.router({
  invite: os.input(z.object({email: z.string()})).handler(...)
})
```

Treat norpc procedure exports as commands at their export name, norpc router exports as subcommand groups, and detect conflicts with scanned plain commands. Document tRPC/oRPC explicit module exports as future work unless the implementation finds a low-risk way to normalize them into norpc without weakening the current root-router-kind guards.

## A5 — 2026-06-19

Yes. First explicit-procedure slice should support trpc-cli's own norpc values only: `os.input(...).handler(...)`, `t.procedure.input(...).query(...)`, and `os.router(...)`/`t.router(...)` values.

That covers zod/standard-schema on selected commands because the explicit procedure carries a runtime Standard Schema, metadata, middleware, aliases, jsonInput, etc. It also composes naturally with generated plain-function procedures because module mode already produces a norpc router internally.

Rules for the proposal:

- A runtime export that is `isNorpcProcedure` becomes a command named after the export.
- A runtime export that is `isNorpcRouter` becomes a subcommand group named after the export.
- These can coexist with source-scanned plain functions and proposed object-literal groups.
- Conflicts between generated commands, explicit procedures, explicit routers, and re-exported children fail loudly.
- If the source scanner sees an exported const whose runtime value is a norpc procedure/router, it should not require a parseable function declaration for it.
- Actual tRPC/oRPC procedure/router exports are future work. They have different root parsing/calling requirements and should not be half-supported in the first pass.

[guess: supporting norpc first gives the user-requested standard-schema/zod escape hatch while keeping the module-mode output as one coherent norpc router.]

---

## Q6 — object-literal group gating — 2026-06-19

Codebase answer: non-function exports are currently ignored (`REGISTRY_URL` is tested), while exported functions that the scanner cannot parse fail loudly. Object-literal groups would introduce a new middle case: an exported object may be an ordinary constant, a plain-function command group, or an explicit norpc router.

**Question 6:** For `export const users = { ... }` same-file groups, should grouping be syntax-gated to object literals with command-shaped method properties, while ordinary exported objects remain ignored?

**Recommended answer:** Yes. Support only direct exported object literals whose properties are parseable command methods/functions:

```ts
export const users = {
  invite(options: {email: string}) {},
  deactivate: async (options: {id: string}) => {},
}
```

If at least one property is command-shaped, the object becomes a subcommand group, and any function-valued property in that object that cannot be parsed should fail loudly. Non-function properties in a command group should fail too unless they are explicit norpc procedures/routers, because a mixed object would make help unpredictable.

Plain exported constants like `export const config = {debug: true}` should stay ignored. Nested object-literal groups can be future work unless represented as explicit `t.router`/`os.router`.

## A6 — 2026-06-19

Yes. Object-literal grouping should be syntax-gated and conservative.

Proposal rules:

- Only direct `export const users = { ... }` object literals are candidates for plain same-file groups.
- The object becomes a command group only when it contains at least one command-shaped property: method shorthand, function-valued property, arrow-function property, norpc procedure, or norpc router.
- Once an object is classified as a command group, all properties must be command-shaped. Non-function data properties should fail loudly rather than be silently ignored inside a group.
- Ordinary exported objects with no command-shaped properties remain ignored, preserving current non-function export behavior.
- Nested object-literal groups are future work unless they are explicit `t.router`/`os.router` values. The first implementation slice can be one level of object-literal grouping plus arbitrary nesting through explicit norpc routers.

[guess: this keeps `export const config = {...}` safe while still giving same-file subcommands without class lifecycle ambiguity.]

---

## Q7 — default command behavior — 2026-06-19

Codebase answer: current module mode gives `export default function named(...)` special treatment: it becomes a command named `named` and also the root default command. Router/procedure mode instead uses `meta.default === true` to mark a default command for any parent. These are two different default mechanisms.

**Question 7:** For explicit norpc procedure/router exports and object-literal groups, should default commands be controlled only by norpc `meta.default`, while the existing automatic default-export behavior stays limited to plain `export default function`?

**Recommended answer:** Yes. Keep the current plain-function default export behavior as-is, because it is already documented and tested. For explicit procedures and routers, do not infer default behavior from `export default`; require `.meta({default: true})` on the procedure. For object-literal groups, support a default child only through an explicit norpc procedure with `meta.default`, not by naming a method `default` in the plain-function group. That keeps default behavior tied to the existing router/procedure metadata model and avoids inventing another source-level convention.

## A7 — 2026-06-19

Yes. Preserve the existing `export default function` behavior for plain functions only.

For explicit norpc procedures/routers, default commands should be controlled by existing `meta.default`, not by default export syntax. Prefer named explicit exports for the first slice:

```ts
export const run = os
  .meta({default: true})
  .input(schema)
  .handler(...)
```

For object-literal plain groups, do not introduce a magic `default()` method convention. If a group needs a default subcommand, use an explicit norpc procedure child with `meta.default`. Plain method names should just be command names.

[guess: this avoids three competing default-command mechanisms while preserving the one shipped plain-function shortcut.]

---

## Stop — 2026-06-19

ready for Phase 2
