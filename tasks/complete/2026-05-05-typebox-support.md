---
status: complete
size: medium
---

# First-class TypeBox support

## Status Summary

Done. TypeBox Standard Schema wrappers map to CLI arguments through `~standard.jsonSchema`, trpc-cli owns the adapter surface via `trpc-cli/typebox`, README usage points at that adapter, and the full build/test suite passes.

## Goal

Make TypeBox feel like a first-class validation library for trpc-cli procedure inputs.

Users should be able to define a TypeBox schema, wrap it in the TypeBox Standard Schema adapter shape, pass that wrapped schema into `.input(...)`, and have trpc-cli:

- validate command input through the Standard Schema interface
- derive CLI arguments/options from the underlying TypeBox JSON Schema
- preserve useful behavior for primitives, objects, enums, tuples, arrays, optional fields, and merged inputs

## Context

TypeBox does not appear to expose Standard Schema directly from the package API. The upstream TypeBox example at `https://github.com/sinclairzx81/typebox/tree/main/example/standard` shows a reference adapter that wraps JSON Schema or TypeBox schemas and attaches `~standard`.

That adapter also exposes `~standard.jsonSchema.input()` and `~standard.jsonSchema.output()`, which should give trpc-cli a simple conversion path without requiring a separate TypeBox-to-JSON-Schema implementation. Since TypeBox schemas are already JSON Schema-ish objects, the conversion may be little more than calling `jsonSchema.input({target: 'draft-07'})` or returning the schema itself.

## Assumptions

- The public TypeBox package does not currently provide a stable import like `typebox/standard`.
- trpc-cli does not need to vendor TypeBox's adapter as public API; tests can define a tiny local wrapper if that matches how TypeBox users are expected to integrate today.
- TypeBox should be added as an optional peer dependency and dev dependency only if the test needs the real package.
- Product support should be based on Standard Schema vendor/jsonSchema detection rather than hard-coding only the local test wrapper.

## Checklist

- [x] Add a TypeBox integration test file that passes TypeBox-backed Standard Schema values into `.input(...)`. _Implemented in `test/typebox.test.ts` with a local wrapper matching the upstream TypeBox adapter shape._
- [x] Cover at least primitive, enum, object/options, optional option, tuple, array, and merged object inputs. _Covered in `test/typebox.test.ts`; top-level optional uses TypeBox's valid `Type.Union([Type.String(), Type.Undefined()])` shape._
- [x] Add or adjust JSON Schema conversion so Standard Schema values with `~standard.jsonSchema` are accepted. _Added generic `~standard.jsonSchema.input({target: 'draft-07'})` support in `src/json-schema.ts`._
- [x] Add TypeBox as an optional peer/dev dependency if the real package is required for tests. _Added `typebox` as a dev dependency for integration coverage and as an optional peer for the `trpc-cli/typebox` adapter export._
- [x] Export a TypeBox adapter from trpc-cli. _Added `src/typebox.ts` and package exports for `trpc-cli/typebox`; tests import `typeboxToStandardSchema` from the library source instead of defining a local wrapper._
- [x] Run the focused TypeBox tests. _`pnpm vitest run test/typebox.test.ts` passes._
- [x] Run the relevant existing validation-library tests. _`pnpm vitest run test/typebox.test.ts test/effect.test.ts test/arktype.test.ts test/valibot.test.ts test/zod3.test.ts test/zod4.test.ts` passes; full `pnpm test` also passes._
- [x] Verify package export behavior. _`pnpm build` emits `dist/typebox.js`/`.d.ts`; Node self-reference import from `trpc-cli/typebox` works._
- [x] Update README or exported docs only if there is a useful user-facing TypeBox note to preserve. _Added a TypeBox validator section documenting the wrapper requirement and Standard JSON Schema conversion path._

## Implementation Notes

- 2026-05-05: Created task from the user request before implementation. The upstream TypeBox example is an adapter around TypeBox/JSON Schema, not a currently documented public import.
- 2026-05-05: Added a failing TypeBox test first. The failure showed trpc-cli falling back to `--input [json]` because TypeBox wrappers were not detected as JSON-schemaable.
- 2026-05-05: Added generic Standard JSON Schema support by detecting `~standard.jsonSchema` on Standard Schema inputs. TypeBox does not need a TypeBox-specific converter because its adapter returns the underlying schema.
- 2026-05-05: Verified with focused TypeBox tests, validator matrix tests, `pnpm compile`, `pnpm lint`, and full `pnpm test`.
- 2026-05-05: Follow-up from review: moved the TypeBox adapter into `src/typebox.ts` and exposed it as `trpc-cli/typebox`, because first-class support should not require users to copy a local adapter.
- 2026-05-05: Re-verified after adding the export with `pnpm vitest run test/typebox.test.ts`, `pnpm compile`, `pnpm lint`, `pnpm build`, a Node self-reference import from `trpc-cli/typebox`, validator matrix tests, and full `pnpm test`.
- 2026-05-05: Renamed the public adapter helper to `typeboxToStandardSchema` to make the conversion explicit.
