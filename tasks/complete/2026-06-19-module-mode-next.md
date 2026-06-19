---
status: complete
size: medium
---

# Module Mode Next

Status summary: implemented and verified. The scoped work documents current type/overload behavior, adds JSDoc aliases for module-mode commands/options, and adds lazy-instantiated class subcommand groups. Exported norpc procedures remain a separate follow-up.

## User Ask

Push module mode further and resolve these design questions:

- Do extended interfaces work? Do intersected types work?
- How should aliases be supported?
- How should overloaded functions behave?
- Can subcommands be supported without `export * as whatever from './whatever.ts'`, perhaps via exported classes?
- Can some functions opt into explicit zod/standard-schema/trpc/orpc/norpc procedure definitions while other module exports remain plain functions?

## Proposal

### Current Behavior To Document

Module mode already supports more of the type story than the release notes implied:

- Inline parameter types and same-file `type`/`interface` declarations work.
- `interface Options extends Base { ... }` works.
- `interface Options extends A, B { ... }` works.
- Object intersections such as `type Opts = {a: string} & {b: string}` work and are flattened into one flag set when possible.
- Trailing intersection-alias options objects work in positional tuple mode.
- Union-of-object option shapes work.
- Overloaded functions already use the first overload signature as the CLI contract.

The boundary should be explicit: plain-function source scanning is same-file and `Type.Script`-parseable only. Imported type references, arbitrary TypeScript compiler resolution, type-annotated const function aliases, and complex declarations that need external type context should keep failing loudly. Users who need richer typing should use explicit runtime schemas/procedures.

### Aliases

Plain-function module mode should support aliases through JSDoc tags:

```ts
/**
 * install dependencies
 * @alias i
 */
export function install(options: {
  /** fail if the lockfile changed
   * @alias f
   */
  frozenLockfile?: boolean
}) {}
```

Rules:

- Repeated command-level `@alias <name>` tags map to `meta.aliases.command`.
- A property-level `@alias <name>` tag maps to that option's alias.
- Alias tags are stripped from help descriptions.
- Invalid or conflicting aliases fail with the same strictness as existing router/procedure aliases.
- No wrapper helper or static metadata side channel for plain functions in this pass.

### Overloads

Keep the current first-signature behavior. A CLI command has one help shape and one validation schema; merging overloads would advertise invalid combinations. Users who want a different CLI shape should reorder overloads, export a CLI-specific wrapper, or export an explicit schema/procedure command.

### Same-File Subcommands

Support exported classes as the only new same-file subcommand grouping syntax. The class is a command group; its public instance methods are subcommands.

Example:

```ts
export class Users {
  /** invite a user */
  invite(options: {email: string}) {
    return options.email
  }

  async deactivate(options: {id: string}) {
    return options.id
  }

  #audit(action: string) {
    // private implementation detail, not a command
  }
}
```

This maps to `mycli users invite` and `mycli users deactivate`.

Rules:

- Only direct `export class Users { ... }` declarations are candidates.
- Classes without a base class may omit the constructor; classes with `extends` must declare an explicit zero-argument constructor.
- Classes with constructor parameters, unsupported inheritance, or no public command methods are ignored as ordinary exports.
- Public instance method declarations directly in the class body become commands.
- Private/protected methods and private fields are internal implementation details, not commands.
- Static methods are not commands in the first slice.
- Method parameter parsing, JSDoc descriptions, aliases, and overload behavior follow the same rules as exported functions.
- Help/schema generation must not instantiate the class.
- Instantiate lazily inside the command handler, and create a fresh instance per command invocation.
- If a public instance method is command-shaped but cannot be parsed, fail loudly.
- Do not add object-literal command groups in this proposal. Ordinary exported object constants stay ignored.

### Explicit Schema/Procedure Exports

This belongs in a separate change, not this first follow-up. Keep the design note, but do not implement it in this proposal's scope.

The likely separate change should support trpc-cli's own norpc values first:

```ts
import {os} from 'trpc-cli'
import {z} from 'zod/v4'

export const explicit = os
  .input(z.object({name: z.string()}))
  .meta({aliases: {command: ['x']}})
  .handler(({input}) => input.name)

export const users = os.router({
  invite: os.input(z.object({email: z.string()})).handler(({input}) => input.email),
})
```

Rules:

- `isNorpcProcedure` runtime exports become commands named after their export.
- `isNorpcRouter` runtime exports become subcommand groups named after their export.
- Explicit norpc exports can coexist with source-scanned plain functions and class groups in that later change.
- Conflicts fail loudly.
- Exported consts whose runtime values are norpc procedures/routers should not require parseable function declarations.
- Actual tRPC/oRPC procedure or router exports are future work; they have different root parsing/calling requirements and should not be half-supported in this pass.

### Default Commands

Preserve existing `export default function` behavior for plain functions only. Do not add a magic `default()` method convention inside class groups.

Default behavior for explicit norpc exports should be handled in the separate explicit-procedure change, using existing `meta.default`.

## Suggested Implementation Slices

1. Documentation and test pins for current type/overload behavior.
2. JSDoc metadata parsing for command and property `@alias`, including stripping tags from descriptions.
3. Lazy-instantiated class command groups.
4. Documentation for non-goals and follow-ups: imported type resolution, object-literal command groups, explicit norpc exports, tRPC/oRPC mixed exports, overload merging, and default-method magic.

## Guesses And Assumptions

- Same-file `Type.Script`-parseable support is the right boundary because it matches the project's preference for loud errors and small pragmatic mechanisms over building a TypeScript compiler.
- JSDoc is the least-bad metadata channel for aliases because module mode already treats source comments as CLI documentation.
- First-overload-only behavior is preferable because Commander help and validation need one concrete public invocation shape.
- Class groups are acceptable when constrained to no constructor arguments, public instance methods only, and lazy per-invocation instantiation. Inheritance is acceptable when the class explicitly declares a zero-argument constructor; unsupported class shapes should be ignored rather than hard errors.
- Explicit norpc exports are probably the right schema escape hatch, but they belong in a separate change because they introduce runtime-export composition beyond plain source-scanned commands.
- Object-literal command groups should be skipped for now so `export const config = {...}` remains unambiguously ordinary data.
- Default command behavior should avoid competing conventions and preserve only the existing plain-function shortcut in this proposal.

## Out Of Scope For This Proposal PR

- Implementing the proposal.
- Switching module mode to the TypeScript compiler API.
- Imported type resolution.
- Object-literal command groups.
- Class groups with constructor arguments.
- Explicit norpc procedure/router exports.
- Mixed tRPC/oRPC/norpc export trees.
- Overload merging or overload-selection metadata.
- Top-level-awaited `createCli(import.meta).run()`.

## Checklist

- [x] Run a grill-you interview against the existing module-mode implementation. _Completed via platform sub-agent fallback after the local `claude --print` path failed with a 401; transcript lives in `tasks/module-mode-next.interview.md`._
- [x] Document factual current behavior for extended interfaces, intersections, aliases, and overloads. _Captured above under "Current Behavior To Document"._
- [x] Propose support rules for aliases, subcommands, and procedure-like exports. _Captured above under the feature-specific proposal sections._
- [x] Capture open risks, tradeoffs, and follow-up implementation slices. _Captured in "Suggested Implementation Slices", "Guesses And Assumptions", and "Out Of Scope"._
- [x] Open a draft PR for review. _Opened as #211._
- [x] Implement JSDoc `@alias` support. _Implemented in `src/module-commands.ts` by stripping `@alias` from JSDoc descriptions and mapping tags onto existing command/option alias metadata._
- [x] Implement lazy class command groups. _Implemented in `src/module-commands.ts`; direct exported classes with no constructor args become nested routers, inherited classes require an explicit zero-argument constructor, unsupported class shapes are ignored, and method handlers instantiate a fresh class instance only when invoked._
- [x] Update docs and tests. _README module-mode docs updated; behavior covered in `test/typebox-module-commands.test.ts`._

## Implementation Notes

- 2026-06-19: Created branch `module-mode-next` from `main`, committed this task stub first, pushed, and opened draft PR #211 before filling in the proposal.
- 2026-06-19: Local `claude --print` sub-agent invocation failed with `401 Invalid authentication credentials`; continued the grill with the platform multi-agent tool.
- 2026-06-19: Quick local probe against built `dist` confirmed same-file extended interfaces, multiple interface extends, and alias-to-alias intersections currently derive flags as expected.
- 2026-06-19: Follow-up user decision replaced object-literal groups with class groups only, scoped to no base class/no constructor args and lazy instantiation.
- 2026-06-19: Follow-up user decision moved support for exported norpc procedures/routers out of scope for this proposal and into a separate change.
- 2026-06-19: Implemented the scoped feature set. `pnpm exec vitest run test/typebox-module-commands.test.ts`, `pnpm compile`, and `pnpm test` pass. `pnpm lint` is blocked only by the pre-existing unstaged `test/zod4.test.ts` unused-disable warning.
- 2026-06-19: Follow-up user decision allowed `extends` when the class declares an explicit zero-argument constructor, and added coverage that TypeScript `private` methods are not commands.
- 2026-06-19: Follow-up user decision changed unsupported class shapes, including constructor parameters, from startup errors to ignored non-command exports.
