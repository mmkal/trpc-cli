---
status: ready
size: medium
---

# First-class TypeBox support

## Status Summary

Early setup is complete. The worktree and task spec exist, but implementation has not started yet. Main expected work is proving TypeBox Standard Schema inputs work through tRPC, adding a small TypeBox JSON Schema conversion path if needed, and documenting the user-facing wrapper shape.

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

- [ ] Add a TypeBox integration test file that passes TypeBox-backed Standard Schema values into `.input(...)`.
- [ ] Cover at least primitive, enum, object/options, optional option, tuple, array, and merged object inputs.
- [ ] Add or adjust JSON Schema conversion so Standard Schema values with `~standard.jsonSchema` are accepted.
- [ ] Add TypeBox as an optional peer/dev dependency if the real package is required for tests.
- [ ] Run the focused TypeBox tests.
- [ ] Run the relevant existing validation-library tests.
- [ ] Update README or exported docs only if there is a useful user-facing TypeBox note to preserve.

## Implementation Notes

- 2026-05-05: Created task from the user request before implementation. The upstream TypeBox example is an adapter around TypeBox/JSON Schema, not a currently documented public import.
