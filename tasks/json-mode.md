---
status: ready
size: medium
branch: json-mode
---

# Add opt-in global JSON input mode

## Status Summary

Spec is ready for implementation. The target is an opt-in way for callers to
enable a universal `--json` flag so any procedure can receive hand-written JSON
input without per-procedure `meta.jsonInput` boilerplate.

## Summary Ask

Provide a way to allow:

```sh
mycli some command --json '{"foo":"bar"}'
```

as an alternate input path for every procedure, while preserving the existing
schema-to-flags behavior by default.

The repo already supports per-procedure `meta.jsonInput`, which maps an input
schema to a single JSON option. This task is about an opt-in global surface that
agents and power users can enable for all procedures.

## Guesses and Assumptions

- The feature should be opt-in at `createCli` or `run` time. It should not add a
  global `--json` flag to every CLI by default.
- `--json` should mean "treat this value as the complete procedure input", not
  "format output as JSON".
- The flag name should avoid conflicting with schema-derived options if possible.
  If a procedure already has a `json` option, the implementation should either
  fail clearly or choose a documented escape hatch.
- The implementation should reuse the same parsing and validation path as normal
  command input after producing the POJO input.
- A "global meta defaults" style surface is acceptable if it fits the current
  parser shape better than a separate run option.

## Checklist

- [ ] Add tests showing `--json` works for object, primitive, tuple, and nested
  command inputs when the feature is enabled.
- [ ] Add a test proving normal CLIs do not get `--json` unless enabled.
- [ ] Define the public opt-in surface in `TrpcCliParams` or `TrpcCliRunParams`.
- [ ] Implement the global JSON input path with clear conflict behavior.
- [ ] Document the agent-friendly usage pattern and the difference from output
  JSON.
- [ ] Run focused JSON/input tests plus compile.

## Out of Scope

- Do not change result logging or add output serialization modes.
- Do not make `meta.jsonInput` obsolete; it should continue to work.
- Do not infer global JSON mode automatically from `process.argv` inside the
  library.

