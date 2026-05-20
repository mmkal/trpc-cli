---
status: prototype-complete
size: large
branch: openapi-proxify
---

# Prototype OpenAPI proxify

## Status Summary

Prototype is implemented and verified. The branch now exposes an experimental
runtime `openapiProxify` helper, fixture coverage for GET/POST operations, and
explicit limitations. Remaining work is product/API review before treating this
as a stable surface.

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

- [x] Research OpenAPI parsing/client options and record the practical tradeoffs
  in this task or PR body. _Recorded below and in PR #200; verified current
  package/docs signals on 2026-05-05._
- [x] Add a fixture OpenAPI schema with at least one GET using path/query params
  and one POST using a JSON request body. _`test/fixtures/openapi.ts` covers
  `getPet` with path/query/header params and `createPet` with a JSON body._
- [x] Add integration tests that run a local test server and invoke the generated
  CLI against it. _`test/openapi-proxify.test.ts` uses a disposable
  `node:http` fixture server and drives the generated CLI._
- [x] Implement a small experimental `openapiProxify` or similarly named helper.
  _`src/openapi-proxify.ts` builds a noRPC router from an OpenAPI 3.x object and
  calls operations via `fetch`._
- [x] Export the helper only with experimental documentation and clear
  limitations. _`src/index.ts` exports the helper/types; the helper JSDoc lists
  first-pass limitations._
- [x] Run focused tests plus compile. _Ran focused OpenAPI spec, `pnpm compile`,
  `pnpm lint`, and full `pnpm test`._

## Out of Scope

- Do not implement full OpenAPI 3.1 semantics in the first pass.
- Do not add Node 22-only dependencies unless the PR is explicitly a no-merge
  research branch.
- Do not generate SDK files or require a build step for the first prototype.

## Implementation Notes

- Kept the prototype dependency-free and Node >=18 compatible by using the
  package's existing noRPC router shape plus native `fetch`.
- `openapiProxify({document, baseUrl, headers, fetch})` accepts an already
  loaded OpenAPI 3.x JSON object, maps each operation to a CLI command, builds a
  JSON-schema input object, and sends path/query/header/body values to the HTTP
  endpoint.
- Operation names use `operationId` when present and fall back to method/path
  names. Names are normalized to camelCase so `createCli` renders kebab-case CLI
  commands.
- Non-2xx responses throw `OpenApiProxifyHttpError` with method, URL, status,
  status text, and parsed response body.

## Research Notes From Implementation

- `openapi-fetch` remains attractive as a small MIT runtime helper, but its main
  ergonomics come from generated `paths` types. Its docs describe a 6 kB,
  near-zero-runtime fetch client, generated `paths` usage, native `fetch`
  wrapping, Node >=18 support, and built-in path/query/body serializer hooks.
  Source: https://openapi-ts.dev/openapi-fetch/ and
  https://openapi-ts.dev/openapi-fetch/api
- `@hey-api/openapi-ts` remains more complete but is codegen-oriented. Its docs
  describe generated production TypeScript code, Node.js 22+ runtime support,
  Fetch/Axios/etc. clients, and plugin-based output. Source:
  https://heyapi.dev/openapi-ts/get-started
- `npm view` on 2026-05-05 confirmed `openapi-fetch@0.17.0` as MIT with one
  runtime dependency (`openapi-typescript-helpers`) and
  `@hey-api/openapi-ts@0.97.1` as MIT with Node `>=22.13.0` plus a larger
  codegen dependency surface. This branch therefore avoids both as required
  runtime dependencies.

## Prototype Limitations

- Accepts already-loaded OpenAPI 3.x JSON objects only. YAML parsing, remote URL
  loading, and remote refs are caller-owned.
- Resolves local `#/...` refs only.
- Supports path, query, and header parameters plus `application/json` request
  bodies. Cookies, multipart, form-urlencoded, and non-JSON request bodies are
  not implemented.
- Serializes query arrays as repeated keys and rejects object-valued query/header
  params. It does not implement the full OpenAPI style/explode matrix.
- Does not validate responses or implement full OpenAPI schema semantics such as
  discriminators.
