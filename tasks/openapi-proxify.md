---
status: ready
size: large
branch: openapi-proxify
---

# Prototype OpenAPI proxify

## Status Summary

Spec is ready for a research-heavy prototype. This should be a draft PR that
shows a credible direction, not necessarily a polished merge candidate. The
highest-value outcome is a small fetch-backed OpenAPI-to-CLI path with clear
limitations and research notes.

## Summary Ask

Explore an OpenAPI equivalent to `proxify`: take an OpenAPI schema plus runtime
request details such as base URL and auth headers, then expose the operations as
a `trpc-cli` CLI backed by `fetch`.

The intended mental model is similar to the existing `proxify` helper for tRPC
routers, but the source is an OpenAPI document rather than a tRPC router.

## Current Research Notes

- `openapi-fetch` latest observed npm version on 2026-05-05 is `0.17.0`, MIT,
  with a small dependency surface, but it is type-driven and expects generated
  TypeScript `paths` types for best ergonomics.
- `@hey-api/openapi-ts` latest observed npm version on 2026-05-05 is `0.97.1`,
  MIT, supports Fetch clients and many plugins, but requires Node `>=22.13.0`
  and has a much larger dependency and codegen surface.
- The package currently targets Node `>=18`, so a runtime helper should avoid
  hard-requiring Node 22-only tooling.

## Guesses and Assumptions

- Start with a runtime OpenAPI document parser that builds a lightweight norpc
  router or pre-parsed command list, rather than codegen.
- Support OpenAPI 3.x JSON objects directly. YAML or remote URL loading can be
  documented as caller-owned unless it is cheap to support with existing deps.
- Initial operation naming can use `operationId` when available and fall back to
  a path/method-derived command name.
- Inputs should combine path params, query params, headers, and JSON request body
  into a single object schema that `trpc-cli` can expose as flags.
- The fetch caller should substitute path params, serialize query params, include
  headers, send JSON bodies, and surface non-2xx responses with useful errors.
- If full OpenAPI coverage is too broad, land a prototype with explicit
  limitations rather than hiding unsupported features.

## Checklist

- [ ] Research OpenAPI parsing/client options and record the practical tradeoffs
  in this task or PR body.
- [ ] Add a fixture OpenAPI schema with at least one GET using path/query params
  and one POST using a JSON request body.
- [ ] Add integration tests that run a local test server and invoke the generated
  CLI against it.
- [ ] Implement a small experimental `openapiProxify` or similarly named helper.
- [ ] Export the helper only with experimental documentation and clear
  limitations.
- [ ] Run focused tests plus compile.

## Out of Scope

- Do not implement full OpenAPI 3.1 semantics in the first pass.
- Do not add Node 22-only dependencies unless the PR is explicitly a no-merge
  research branch.
- Do not generate SDK files or require a build step for the first prototype.

