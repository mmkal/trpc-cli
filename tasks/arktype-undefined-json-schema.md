---
status: ready
size: small
branch: arktype-undefined-json-schema
---

# Preserve Arktype object flags when input allows undefined

## Status Summary

Spec captured. Implementation has not started yet. The intended fix is to
reproduce the `type({...}).or('undefined')` Arktype JSON Schema issue through
the public CLI behavior, then extend the existing Arktype JSON Schema fallback
only if the current workaround does not already cover it.

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

- [ ] Add a failing Arktype CLI test for an optional object input unioned with
  `undefined`.
- [ ] Extend the Arktype JSON Schema workaround only as much as needed for that
  test.
- [ ] Run the focused Arktype test and the package test suite.
- [ ] Push the branch and open a pull request if code or tests change.

