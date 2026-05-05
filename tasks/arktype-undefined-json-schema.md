---
status: implemented
size: small
branch: arktype-undefined-json-schema
---

# Preserve Arktype object flags when input allows undefined

## Status Summary

Implementation is complete locally and awaiting push/PR.
The red test reproduced the Arktype optional-object wrapper issue through public
CLI behavior. The parser now unwraps `anyOf` unions that contain one concrete
schema plus optional markers, so object options are discovered while unsupported
record-style schemas still fall back to JSON input with a clearer reason.

## Summary Ask

`trpc-cli` already has a workaround for Arktype's inability to emit JSON Schema
for the `undefined` unit. Verify whether that workaround handles a command input
whose schema is an object flag bag unioned with `undefined`, such as
`type({'port?': 'number'}).or('undefined')`.

The observable behavior should be that CLI flags are still discovered from the
object branch. A command like `serve --port 56081` should get `{port: 56081}`,
and `serve --help` should show `--port` rather than falling back to the generic
`--input [json]` path.

## Assumptions

- Exercise the behavior through the public `createCli`/`run` test helper rather
  than by asserting on private converter internals.
- If the current workaround already handles the case, stop after documenting the
  result rather than forcing a code change.
- If it fails, keep the fix scoped to Arktype JSON Schema conversion and preserve
  existing Zod, Valibot, and Effect behavior.

## Checklist

- [x] Add a failing Arktype CLI test for an optional object input unioned with
  `undefined`. _Added a public CLI behavior test in `test/arktype.test.ts`; it
  failed because `--port` was unknown and help fell back to `--input [json]`._
- [x] Extend the Arktype JSON Schema workaround only as much as needed for that
  test. _`src/parse-procedure.ts` now unwraps `anyOf` when exactly one branch is
  non-optional, reusing the existing object/tuple/primitive parsing path._
- [x] Run the focused Arktype test and the package test suite. _Focused
  red/green test passes; Arktype/Zod4/Valibot suites, compile, lint, and the
  full Vitest suite pass._
- [ ] Push the branch and open a pull request if code or tests change.

## Implementation Notes

- The existing Arktype converter already maps the unsupported `undefined` unit
  to `{optional: true}` via `toJsonSchema({fallback})`.
- The missing piece was downstream parsing: object-shaped `anyOf` unions with an
  optional marker were not reduced to their object branch, so the CLI could not
  discover flags.
