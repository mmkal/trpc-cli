/*
 * TypeBox Standard Schema adapter.
 *
 * Attribution: adapted from TypeBox's MIT-licensed Standard Schema reference adapter:
 * https://github.com/sinclairzx81/typebox/tree/main/example/standard
 * Copyright (c) 2017-2026 Haydn Paterson
 *
 * Modifications: reuse trpc-cli's existing StandardSchemaV1 contract, keep only the
 * TypeBox adapter surface trpc-cli needs, and expose a lower-case factory plus the
 * upstream-style StandardSchemaV1 alias.
 */

import type {Static, TSchema} from 'typebox'
import type {TLocalizedValidationError} from 'typebox/error'
import {Validator} from 'typebox/schema'
import type {StandardSchemaV1 as StandardSchemaV1Contract} from './standard-schema/contract.js'

export type TypeBoxStandardJsonSchemaOptions = {
  target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {})
  libraryOptions?: Record<string, unknown>
}

export type TypeBoxStandardJsonSchemaConverter = {
  input: (options: TypeBoxStandardJsonSchemaOptions) => Record<string, unknown>
  output: (options: TypeBoxStandardJsonSchemaOptions) => Record<string, unknown>
}

export type TypeBoxStandardSchema<Type extends TSchema> = StandardSchemaV1Contract<Static<Type>> & {
  '~standard': StandardSchemaV1Contract.Props<Static<Type>> & {
    jsonSchema: TypeBoxStandardJsonSchemaConverter
  }
}

export function standardSchema<Type extends TSchema>(schema: Type): TypeBoxStandardSchema<Type> {
  const validator = new Validator({}, schema)
  const jsonSchema = {
    input: () => validator.Schema() as Record<string, unknown>,
    output: () => validator.Schema() as Record<string, unknown>,
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
  } as TypeBoxStandardSchema<Type>
}

export {standardSchema as StandardSchemaV1}

function pathSegments(error: TLocalizedValidationError) {
  if (!error.instancePath) return []
  return error.instancePath
    .slice(1)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}
