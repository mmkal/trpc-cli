/*
 * TypeBox Standard Schema adapter, for the vendored typebox in ./vendor.
 *
 * Attribution: adapted from TypeBox's MIT-licensed Standard Schema reference adapter:
 * https://github.com/sinclairzx81/typebox/tree/main/example/standard
 * Copyright (c) 2017-2026 Haydn Paterson
 *
 * Modifications: reuses trpc-cli's StandardSchemaV1 contract, targets the vendored typebox
 * modules instead of the typebox package, attaches `~standard` lazily and non-enumerably to
 * plain schema objects (instead of wrapping them in a StandardSchema class) so that
 * console.log/JSON.stringify of schemas stays clean JSON Schema, and declares the `~standard`
 * type on the vendored TSchema interface so plain typebox schemas are accepted by
 * trpc/orpc/norpc `.input(...)` without a wrapper.
 */

import type {StandardSchemaV1} from '../standard-schema/contract.js'
import type {Static} from './vendor/index.js'
import {Validator} from './vendor/schema/index.js'

export interface StandardJsonSchemaOptions {
  /** The target version of the generated JSON Schema. typebox schemas *are* JSON schemas, compatible with draft-07 and later drafts for the keyword subset typebox emits, so this is accepted but not acted on. */
  target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | ({} & string)
  libraryOptions?: Record<string, unknown> | undefined
}

/** The [Standard JSON Schema](https://standardschema.dev/json-schema) converter interface. */
export interface StandardJsonSchemaConverter {
  input: (options: StandardJsonSchemaOptions) => Record<string, unknown>
  output: (options: StandardJsonSchemaOptions) => Record<string, unknown>
}

type TypeboxStatic<Schema> = Schema extends import('./vendor/type/types/schema.js').TSchema
  ? Static<Schema>
  : never

/**
 * The `~standard` props attached to schemas built via `trpc-cli/typebox` - StandardSchemaV1 plus
 * [Standard JSON Schema](https://standardschema.dev/json-schema).
 *
 * Generic over the *schema* type (not the inferred static type), with an explicit `out` variance
 * annotation. This matters for compile performance: the prop is declared on the base `TSchema`
 * interface below, so it participates in every schema-to-schema assignability check inside the
 * vendored typebox source. The variance annotation lets tsc relate
 * `TypeboxStandardProps<A> extends TypeboxStandardProps<B>` by relating `A extends B` directly
 * (a relation it is usually already computing), instead of structurally expanding
 * `Static<A>`/`Static<B>` - which OOMs tsc at 4GB on the 700-file vendored source.
 * `Static` evaluation is deferred to the points that actually need the inferred type
 * (trpc/orpc/norpc `.input(...)` inference).
 */
export interface TypeboxStandardProps<out Schema> {
  readonly version: 1
  readonly vendor: 'typebox'
  readonly validate: (value: unknown) => StandardSchemaV1.Result<TypeboxStatic<Schema>>
  readonly types?: {readonly input: TypeboxStatic<Schema>; readonly output: TypeboxStatic<Schema>} | undefined
  readonly jsonSchema: StandardJsonSchemaConverter
}

declare module './vendor/type/types/schema.js' {
  /**
   * Type-level declaration of the `~standard` prop that the `trpc-cli/typebox` export surface
   * attaches (lazily, non-enumerably) to schemas returned by its builders. Declared on the base
   * TSchema interface (using the polymorphic `this` type) so that every builder keeps its exact
   * vendored signature while the schemas it returns still satisfy StandardSchemaV1 - which is
   * what lets trpc/orpc/norpc `.input(...)` accept them and infer input types via `Static`.
   *
   * Note: at runtime only schemas returned by `trpc-cli/typebox` builders actually carry the
   * prop - nested sub-schemas don't, which is fine since users pass top-level schemas to
   * `.input(...)`.
   */
  interface TSchema {
    readonly '~standard': TypeboxStandardProps<this>
  }
}

/**
 * Attaches a lazily-built, non-enumerable `~standard` prop (StandardSchemaV1 +
 * [Standard JSON Schema](https://standardschema.dev/json-schema)) to a typebox schema.
 * Idempotent: passing the same schema twice is a no-op. Non-schema values are returned as-is.
 */
export function attachStandardSchema<T>(value: T): T {
  if (!looksLikeSchema(value)) return value
  if (Object.getOwnPropertyDescriptor(value, '~standard')) return value
  let props: StandardSchemaV1.Props<unknown, unknown> | undefined
  Object.defineProperty(value, '~standard', {
    configurable: true,
    enumerable: false,
    get: () => (props ||= createStandardProps(value)),
  })
  return value
}

/** All typebox schemas are created via Memory.Create with a hidden (non-enumerable) `~kind` key. */
const looksLikeSchema = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && '~kind' in value

function createStandardProps(schema: object): StandardSchemaV1.Props<unknown, unknown> & {
  vendor: 'typebox'
  jsonSchema: StandardJsonSchemaConverter
} {
  let validator: Validator | undefined
  const getValidator = () => (validator ||= new Validator({}, schema as never))
  return {
    version: 1,
    vendor: 'typebox',
    validate: value => {
      const v = getValidator()
      if (v.Check(value)) return {value}
      const [, errors] = v.Errors(value)
      return {issues: errors.map(error => ({path: pathSegments(error.instancePath), message: error.message}))}
    },
    jsonSchema: {
      input: () => getValidator().Schema() as never,
      output: () => getValidator().Schema() as never,
    },
  }
}

function pathSegments(pointer: string): string[] {
  if (pointer.length === 0) return []
  return pointer
    .slice(1)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}
