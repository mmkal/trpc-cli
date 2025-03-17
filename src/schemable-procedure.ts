import type {JSONSchema7, JSONSchema7Definition} from 'json-schema'
import {z as zod} from 'zod'
import {StandardSchemaV1} from 'zod/lib/standard-schema'
import zodToJsonSchema, {JsonSchema7AllOfType} from 'zod-to-json-schema'
import {CliValidationError} from './errors'
import type {Result, ParsedProcedure} from './types'
import {looksLikeInstanceof} from './util'

// function getInnerType(zodType: JSONSchema7): JSONSchema7 {
//   if (looksLikeInstanceof(zodType, z.ZodOptional) || looksLikeInstanceof(zodType, z.ZodNullable)) {
//     return getInnerType(zodType._def.innerType as z.ZodType)
//   }
//   if (looksLikeInstanceof(zodType, z.ZodEffects)) {
//     return getInnerType(zodType.innerType() as z.ZodType)
//   }
//   return zodType
// }

function looksLikeJsonSchema(value: unknown): value is JSONSchema7 & {type: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (typeof value.type === 'string' || Array.isArray(value.type))
  )
}

type JsonSchemaable = zod.ZodType | {toJsonSchema: () => JSONSchema7}

function looksJsonSchemaable(value: unknown): value is JsonSchemaable {
  const val = value as null | undefined | {toJsonSchema?: unknown}
  return (
    looksLikeInstanceof(val, zod.ZodType as new (...args: unknown[]) => zod.ZodType) ||
    (!!val && 'toJsonSchema' in val && typeof val.toJsonSchema === 'function')
  )
}

function toJsonSchema(input: JsonSchemaable): JSONSchema7 {
  const jsonSchema = 'toJsonSchema' in input ? input.toJsonSchema() : (zodToJsonSchema(input as never) as JSONSchema7)
  return Object.assign(jsonSchema, {originalSchema: input})
}

type ConvertedJsonSchema = JSONSchema7 & {originalSchema: StandardSchemaV1}

export function parseProcedureInputs(inputs: unknown[]): Result<ParsedProcedure> {
  if (inputs.length === 0) {
    return {
      success: true,
      value: {
        positionalParameters: [],
        parameters: [],
        optionsJsonSchema: {},
        getPojoInput: () => ({}),
      },
    }
  }

  const allJsonSchemaable = inputs.every(input => looksJsonSchemaable(input))
  if (!allJsonSchemaable) {
    return {
      success: false,
      error: `Invalid input type ${inputs.map(s => (s as {})?.constructor.name).join(', ')}, only inputs that can be converted to JSON Schema are supported`,
    }
  }

  if (inputs.length > 1) {
    throw new Error('Multi-input types are not supported')
    return parseMultiInputs(inputs.map(toJsonSchema))
  }

  const mergedSchema = toJsonSchema(inputs[0])

  if (mergedSchema.type === 'string') {
    return {
      success: true,
      value: {
        parameters: null as never,
        positionalParameters: [
          {
            type: 'string',
            array: false,
            description: mergedSchema.description || 'a string of some kind',
            name: 'string',
            required: true,
          },
        ],
        optionsJsonSchema: {},
        getPojoInput: argv => argv.positionalValues[0] as string,
      },
    }
  }

  if (acceptedLiteralTypes(mergedSchema).length > 0) {
    return parseLiteralInput(mergedSchema)
  }

  if (isTuple(mergedSchema)) {
    return parseTupleInput(mergedSchema)
  }

  // if (looksLikeArray(mergedSchema) && acceptedLiteralTypes(mergedSchema.element).length > 0) {
  //   return parseArrayInput(mergedSchema)
  // }

  if (mergedSchema.type === 'array') {
    return parseArrayInput(mergedSchema)
  }

  if (mergedSchema.type !== 'object') {
    return {
      success: false,
      error: `Invalid input type ${mergedSchema.type as string}, expected object or tuple`,
    }
  }

  return {
    success: true,
    value: {
      positionalParameters: [],
      parameters: [],
      optionsJsonSchema: mergedSchema,
      getPojoInput: argv => argv.options,
    },
  }
}

// zod-to-json-schema turns `z.string().optional()` into `{"anyOf":[{"not":{}},{"type":"string"}]}`
function isOptional(schema: JSONSchema7Definition) {
  const anyOf = schemaDefPropValue(schema, 'anyOf')
  return anyOf?.length === 2 && JSON.stringify(anyOf[0]) === '{"not":{}}'
}

function parseLiteralInput(schema: JSONSchema7): Result<ParsedProcedure> {
  const type = acceptedLiteralTypes(schema).at(0)
  const name = (schema.description || type || 'value').replaceAll(/\s+/g, '_')
  return {
    success: true,
    value: {
      positionalParameters: [
        {
          name,
          array: false,
          description: schema.description || '',
          required: !isOptional(schema),
          type: type!,
        },
      ],
      parameters: null as never,
      optionsJsonSchema: {},
      getPojoInput: argv => convertPositional(schema, argv.positionalValues[0] as string),
    },
  }
}

const schemaDefPropValue = <K extends keyof JSONSchema7>(
  schema: JSONSchema7Definition,
  prop: K,
): JSONSchema7[K] | undefined => {
  if (schema && typeof schema === 'object' && prop in schema) return schema[prop]
  return undefined
}

function acceptedLiteralTypes(schema: JSONSchema7Definition) {
  const candidates = ['string', 'number', 'boolean', 'integer'] as const
  const typeList =
    schemaDefPropValue(schema, 'type') ||
    schemaDefPropValue(schema, 'oneOf')?.flatMap(s => schemaDefPropValue(s, 'type')) ||
    schemaDefPropValue(schema, 'anyOf')?.flatMap(s => schemaDefPropValue(s, 'type'))
  const acceptedJsonSchemaTypes = new Set([typeList].flat().filter(Boolean))
  return candidates.filter(c => acceptedJsonSchemaTypes.has(c))
}

function parseMultiInputs(inputs: JSONSchema7[]): Result<ParsedProcedure> {
  const allObjects = inputs.every(acceptsObject)
  if (!allObjects) {
    return {
      success: false,
      error: `Invalid multi-input type ${inputs.map(s => s.type).join(', ')}. All inputs must accept object inputs.`,
    }
  }

  const parsedIndividually = inputs.map(input => parseProcedureInputs([input]))

  const failures = parsedIndividually.flatMap(p => (p.success ? [] : [p.error]))
  if (failures.length > 0) {
    return {success: false, error: failures.join('\n')}
  }

  return {
    success: true,
    value: {
      positionalParameters: [],
      parameters: [],
      optionsJsonSchema: {
        allOf: parsedIndividually.map(p => {
          const successful = p as Extract<typeof p, {success: true}>
          return successful.value.optionsJsonSchema
        }),
      },
      getPojoInput: argv => argv.options,
    },
  }
}

function isNullable(schema: JSONSchema7) {
  return Array.isArray(schema.type) && schema.type.includes('null')
}

const tupleItemsSchemas = (schema: JSONSchema7Definition): JSONSchema7Definition[] | undefined => {
  if (!schema || typeof schema !== 'object') return undefined
  if (Array.isArray(schema.items)) return schema.items
  if ('prefixItems' in schema && Array.isArray(schema.prefixItems)) return schema.prefixItems as JSONSchema7Definition[]
  return undefined
}

function isTuple(schema: JSONSchema7): schema is JSONSchema7 & {items: JSONSchema7[]} {
  return Array.isArray(tupleItemsSchemas(schema))
}

function isArray(schema: JSONSchema7): schema is JSONSchema7 & {items: {type: unknown}} {
  return schema.type === 'array' && Boolean(schema.items)
}

function parseArrayInput(array: JSONSchema7 & {items: {type: unknown}}): Result<ParsedProcedure> {
  if (looksLikeJsonSchema(array.items) && isNullable(array.items)) {
    return {
      success: false,
      error: `Invalid input type Array<${array.items.type}>. Nullable arrays are not supported.`,
    }
  }
  return {
    success: true,
    value: {
      positionalParameters: [
        {
          name: parameterName(array, 1),
          array: true,
          description: array.description || '',
          required: !isOptional(array),
          type: 'string',
        },
      ],
      parameters: null as never,
      optionsJsonSchema: {},
      getPojoInput: argv => (argv.positionalValues.at(-1) as string[]).map(s => convertPositional(array.items, s)),
    },
  }
}

function parseTupleInput(tuple: JSONSchema7Definition): Result<ParsedProcedure> {
  const items = tupleItemsSchemas(tuple)
  if (!Array.isArray(items)) throw new Error('.items is not an array, is this really a tuple?')

  const flagsSchemaIndex = items.findIndex(item => {
    if (acceptedLiteralTypes(item as JSONSchema7).length > 0) {
      return false // it's a string, number or boolean
    }
    if (looksLikeArray(item) && acceptedLiteralTypes(item.items as JSONSchema7).length > 0) {
      return false // it's an array of strings, numbers or booleans
    }
    return true // it's not a string, number, boolean or array of strings, numbers or booleans. So it's probably a flags object
  })
  const types = `[${items.map(s => schemaDefPropValue(s, 'type')).join(', ')}]`

  if (flagsSchemaIndex > -1 && flagsSchemaIndex !== items.length - 1) {
    return {
      success: false,
      error: `Invalid input type ${types}. Positional parameters must be strings, numbers or booleans.`,
    }
  }

  const flagsSchema = flagsSchemaIndex === -1 ? null : items[flagsSchemaIndex]

  if (flagsSchema && !acceptsObject(flagsSchema as JSONSchema7)) {
    return {
      success: false,
      error: `Invalid input type ${types}. The last type must accept object inputs.`,
    }
  }

  const positionalSchemas = flagsSchemaIndex === -1 ? items : items.slice(0, flagsSchemaIndex)

  const parameterNames = positionalSchemas.map((item, i) => parameterName(item, i + 1))

  return {
    success: true,
    value: {
      positionalParameters: positionalSchemas.map((schema, i) => ({
        name: parameterName(schema, i + 1),
        array: looksLikeArray(schema),
        description: schemaDefPropValue(schema, 'description') || '',
        required: !isOptional(schema),
        type: 'string',
      })),
      parameters: parameterNames,
      optionsJsonSchema: flagsSchema && typeof flagsSchema === 'object' ? flagsSchema : {},
      getPojoInput: commandArgs => {
        const inputs: unknown[] = commandArgs.positionalValues.map((v, i) => {
          const correspondingSchema = positionalSchemas[i]
          if (looksLikeArray(correspondingSchema)) {
            if (!Array.isArray(v)) {
              throw new CliValidationError(`Expected array at position ${i}, got ${typeof v}`)
            }
            return v.map(s => {
              if (!correspondingSchema.items || Array.isArray(correspondingSchema.items)) return s
              return convertPositional(correspondingSchema.items, s)
            })
          }
          if (typeof v !== 'string') {
            throw new CliValidationError(`Expected string at position ${i}, got ${typeof v}`)
          }
          return convertPositional(correspondingSchema, v)
        })

        if (flagsSchema) {
          inputs.push(commandArgs.options)
        }
        return inputs
      },
    },
  }

  // throw new Error('reached old zod code')

  // if (Math.random()) {
  //   const flagsSchemaIndex = tuple.items.findIndex(item => {
  //     if (acceptedLiteralTypes(item).length > 0) {
  //       return false // it's a string, number or boolean
  //     }
  //     if (looksLikeArray(item) && acceptedLiteralTypes(item.element).length > 0) {
  //       return false // it's an array of strings, numbers or booleans
  //     }
  //     return true // it's not a string, number, boolean or array of strings, numbers or booleans. So it's probably a flags object
  //   })
  //   const types = `[${tuple.items.map(s => s.type).join(', ')}]`

  //   if (flagsSchemaIndex > -1 && flagsSchemaIndex !== tuple.items.length - 1) {
  //     return {
  //       success: false,
  //       error: `Invalid input type ${types}. Positional parameters must be strings, numbers or booleans.`,
  //     }
  //   }

  //   const flagsSchema = flagsSchemaIndex === -1 ? null : tuple.items[flagsSchemaIndex]

  //   if (flagsSchema && !acceptsObject(flagsSchema)) {
  //     return {
  //       success: false,
  //       error: `Invalid input type ${types}. The last type must accept object inputs.`,
  //     }
  //   }

  //   const positionalSchemas = flagsSchemaIndex === -1 ? tuple.items : tuple.items.slice(0, flagsSchemaIndex)

  //   const parameterNames = positionalSchemas.map((item, i) => parameterName(item, i + 1))

  //   return {
  //     success: true,
  //     value: {
  //       positionalParameters: positionalSchemas.map((schema, i) => ({
  //         name: parameterName(schema, i + 1),
  //         array: looksLikeArray(schema),
  //         description: schema.description || '',
  //         required: !schema.isOptional(),
  //         type: 'string',
  //       })),
  //       parameters: parameterNames,
  //       optionsJsonSchema: flagsSchema ? zodToJsonSchema(flagsSchema) : {},
  //       getPojoInput: commandArgs => {
  //         const inputs: unknown[] = commandArgs.positionalValues.map((v, i) => {
  //           const correspondingSchema = positionalSchemas[i]
  //           if (looksLikeArray(correspondingSchema)) {
  //             if (!Array.isArray(v)) {
  //               throw new CliValidationError(`Expected array at position ${i}, got ${typeof v}`)
  //             }
  //             return v.map(s => convertPositional(correspondingSchema.element, s))
  //           }
  //           if (typeof v !== 'string') {
  //             throw new CliValidationError(`Expected string at position ${i}, got ${typeof v}`)
  //           }
  //           return convertPositional(correspondingSchema, v)
  //         })

  //         if (flagsSchema) {
  //           inputs.push(commandArgs.options)
  //         }
  //         return inputs
  //       },
  //     },
  //   }
  // }
}

/**
 * Converts a positional string to parameter into a number if the target schema accepts numbers, and the input can be parsed as a number.
 * If the target schema accepts numbers but it's *not* a valid number, just return a string.
 * trpc will use zod to handle the validation before invoking the procedure.
 */
const convertPositional = (schema: JSONSchema7Definition, value: string) => {
  let preprocessed: string | number | boolean | undefined = undefined

  const acceptedTypes = new Set(acceptedLiteralTypes(schema))
  if (acceptedTypes.has('boolean')) {
    if (value === 'true') preprocessed = true
    else if (value === 'false') preprocessed = false
  }

  if (acceptedTypes.has('number')) {
    const number = Number(value)
    if (!Number.isNaN(number)) {
      preprocessed = number
    }
  }

  if (acceptedTypes.has('integer')) {
    const integer = Number(value)
    if (Number.isInteger(integer)) {
      preprocessed = integer
    }
  }

  // had to disable the below because with standard-schema we can no longer validate individual tuple items, just the whole type
  // if (acceptedTypes.has('string') && !standardSchemaSafeParse(schema, preprocessed).success) {
  //   // it's possible we converted to a number prematurely - need to account for `z.union([z.string(), z.number().int()])`, where 1.2 should be a string, not a number
  //   // in that case, we would have set preprocessed to a number, but it would fail validation, so we need to reset it to a string here
  //   preprocessed = value
  // }

  if (preprocessed === undefined) {
    return value // we didn't convert to a number or boolean, so just return the string
  }

  // if (standardSchemaSafeParse(schema, preprocessed).success) {
  //   return preprocessed // we converted successfully, and the type looks good, so use the preprocessed value
  // }

  // if (acceptedTypes.has('string')) {
  //   return value // we converted successfully, but the type is wrong. However strings are also accepted, so return the string original value, it might be ok.
  // }

  // we converted successfully, but the type is wrong. However, strings are also not accepted, so don't return the string original value. Return the preprocessed value even though it will fail - it's probably a number failing because of a `.refine(...)` or `.int()` or `.positive()` or `.min(1)` etc. - so better to have a "must be greater than zero" error than "expected number, got string"
  return preprocessed
}

const looksLikeArray = (schema: JSONSchema7Definition): schema is JSONSchema7 & {type: 'array'} => {
  return schemaDefPropValue(schema, 'type') === 'array'
}

const toRoughJsonSchema7 = (schema: JSONSchema7Definition | undefined): JSONSchema7 => {
  if (!schema || typeof schema !== 'object') {
    return {}
  }

  return schema
}

const parameterName = (s: JSONSchema7Definition, position: number): string => {
  if (looksLikeArray(s)) {
    const items = toRoughJsonSchema7(s).items
    const elementName = parameterName(!items || Array.isArray(items) ? {} : items, position)
    return `[${elementName.slice(1, -1)}...]`
  }
  // commander requiremenets: no special characters in positional parameters; `<name>` for required and `[name]` for optional parameters
  const name = schemaDefPropValue(s, 'description') || `parameter_${position}`.replaceAll(/\W+/g, ' ').trim()
  return isOptional(s) ? `[${name}]` : `<${name}>`
}

/**
 * Curried function which tells you whether a given zod type accepts any inputs of a given target type.
 * Useful for static validation, and for deciding whether to preprocess a string input before passing it to a zod schema.
 * @example
 * const acceptsString = accepts(z.string())
 *
 * acceptsString(z.string()) // true
 * acceptsString(z.string().nullable()) // true
 * acceptsString(z.string().optional()) // true
 * acceptsString(z.string().nullish()) // true
 * acceptsString(z.number()) // false
 * acceptsString(z.union([z.string(), z.number()])) // true
 * acceptsString(z.union([z.number(), z.boolean()])) // false
 * acceptsString(z.intersection(z.string(), z.number())) // false
 * acceptsString(z.intersection(z.string(), z.string().max(10))) // true
 */
// export function accepts<ZodTarget extends z.ZodType>(target: ZodTarget) {
//   const test = (zodType: z.ZodType): boolean => {
//     const innerType = getInnerType(zodType)
//     if (looksLikeInstanceof(innerType, target.constructor as new (...args: unknown[]) => ZodTarget)) return true
//     if (looksLikeInstanceof(innerType, z.ZodLiteral)) return target.safeParse(innerType.value).success
//     if (looksLikeInstanceof(innerType, z.ZodEnum)) return innerType.options.some(o => target.safeParse(o).success)
//     if (looksLikeInstanceof(innerType, z.ZodUnion)) return innerType.options.some(test)
//     if (looksLikeInstanceof<z.ZodEffects<z.ZodType>>(innerType, z.ZodEffects)) return test(innerType.innerType())
//     if (looksLikeInstanceof<z.ZodIntersection<z.ZodType, z.ZodType>>(innerType, z.ZodIntersection))
//       return test(innerType._def.left) && test(innerType._def.right)

//     return false
//   }
//   return test
// }

// const acceptsString = accepts(z.string())
// const acceptsNumber = accepts(z.number())
// const acceptsBoolean = accepts(z.boolean())
// const acceptsObject = accepts(z.object({}))
const acceptsObject = (schema: JSONSchema7) => schema.type === 'object'
