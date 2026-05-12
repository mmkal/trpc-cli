/*
 * TypeBox Standard Schema adapter.
 *
 * Attribution: adapted from TypeBox's MIT-licensed Standard Schema reference adapter:
 * https://github.com/sinclairzx81/typebox/tree/main/example/standard
 * Copyright (c) 2017-2026 Haydn Paterson
 *
 * Modifications: reuse trpc-cli's existing StandardSchemaV1 contract, keep only the
 * TypeBox adapter surface trpc-cli needs, and expose a trpc-cli-specific factory name.
 */

import {createRequire} from 'module'
import type {StandardSchemaV1 as StandardSchemaV1Contract} from './standard-schema/contract.js'

const require = createRequire(import.meta.url)

type TypeBoxValidationError = {
  instancePath: string
  message: string
}

type TypeBoxValidator = {
  Check: (value: unknown) => boolean
  Errors: (value: unknown) => [boolean, TypeBoxValidationError[]]
  Schema: () => Record<string, unknown>
}

type TypeBoxSchemaModule = {
  Validator: new (context: Record<PropertyKey, unknown>, schema: TypeBoxSchemaLike) => TypeBoxValidator
}

type Simplify<T> = {[K in keyof T]: T[K]} & {}

export type TypeBoxSchemaLike = object

export type TypeBoxStatic<Schema> = Schema extends {const: infer Value}
  ? Value
  : Schema extends {anyOf: infer Variants extends readonly unknown[]}
    ? TypeBoxStatic<Variants[number]>
    : Schema extends {type: 'string'}
      ? string
      : Schema extends {type: 'number' | 'integer'}
        ? number
        : Schema extends {type: 'boolean'}
          ? boolean
          : Schema extends {type: 'undefined'}
            ? undefined
            : Schema extends {type: 'null'}
              ? null
              : Schema extends {type: 'array'; items: infer Items}
                ? Items extends readonly unknown[]
                  ? {[Index in keyof Items]: TypeBoxStatic<Items[Index]>}
                  : TypeBoxStatic<Items>[]
                : Schema extends {type: 'object'; properties: infer Properties extends Record<string, unknown>}
                  ? TypeBoxObjectStatic<
                      Properties,
                      Schema extends {required: readonly (infer Required)[]} ? Extract<Required, string> : never
                    >
                  : unknown

type TypeBoxObjectStatic<Properties extends Record<string, unknown>, RequiredKeys extends string> = Simplify<
  {
    [Key in Extract<keyof Properties, RequiredKeys>]: TypeBoxStatic<Properties[Key]>
  } & {
    [Key in Exclude<keyof Properties, RequiredKeys>]?: TypeBoxStatic<Properties[Key]>
  }
>

export type TypeBoxStandardJsonSchemaOptions = {
  target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {})
  libraryOptions?: Record<string, unknown>
}

export type TypeBoxStandardJsonSchemaConverter = {
  input: (options: TypeBoxStandardJsonSchemaOptions) => Record<string, unknown>
  output: (options: TypeBoxStandardJsonSchemaOptions) => Record<string, unknown>
}

export type TypeBoxStandardSchema<Schema extends TypeBoxSchemaLike> = StandardSchemaV1Contract<
  TypeBoxStatic<Schema>
> & {
  '~standard': StandardSchemaV1Contract.Props<TypeBoxStatic<Schema>> & {
    jsonSchema: TypeBoxStandardJsonSchemaConverter
  }
}

export function typeboxToStandardSchema<Schema extends TypeBoxSchemaLike>(
  schema: Schema,
): TypeBoxStandardSchema<Schema> {
  const {Validator} = getTypeBoxSchemaModule()
  const validator = new Validator({}, schema)
  const jsonSchema = {
    input: () => validator.Schema(),
    output: () => validator.Schema(),
  }

  return {
    '~standard': {
      version: 1,
      vendor: 'typebox',
      validate(value) {
        if (validator.Check(value)) return {value}
        const [_result, errors] = validator.Errors(value)
        return {
          issues: errors.map(error => ({
            path: pathSegments(error),
            message: error.message,
          })),
        }
      },
      jsonSchema,
    },
  } as TypeBoxStandardSchema<Schema>
}

function getTypeBoxSchemaModule(): TypeBoxSchemaModule {
  try {
    return require('typebox/schema') as TypeBoxSchemaModule
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`typebox must be installed to use typeboxToStandardSchema. Error loading: ${message}`)
  }
}

function pathSegments(error: TypeBoxValidationError) {
  if (!error.instancePath) return []
  return error.instancePath
    .slice(1)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}
