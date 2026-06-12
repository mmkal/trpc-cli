/**
 * Types for [Standard JSON Schema](https://standardschema.dev/json-schema) - the
 * `~standard.jsonSchema` extension to the standard-schema contract in ./contract.ts.
 *
 * Shared between the generic Standard JSON Schema detection in src/json-schema.ts and the
 * typebox implementation in src/typebox/standard.ts. Lives here (rather than in either of those
 * files) so that src/json-schema.ts doesn't depend on the vendored typebox, and the
 * `trpc-cli/typebox` entrypoint's declarations don't depend on src/json-schema.ts (whose
 * declarations reference optional peer dependency types like valibot/effect/zod).
 */

/** Options passed to a Standard JSON Schema converter function. */
export interface StandardJsonSchemaOptions {
  /** The target version of the generated JSON Schema. */
  target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {})
  libraryOptions?: Record<string, unknown> | undefined
}

/** The [Standard JSON Schema](https://standardschema.dev/json-schema) `~standard.jsonSchema` converter interface. */
export interface StandardJsonSchemaConverter {
  input: (options: StandardJsonSchemaOptions) => Record<string, unknown>
  output: (options: StandardJsonSchemaOptions) => Record<string, unknown>
}
