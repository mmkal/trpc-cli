import type {JSONSchema7} from 'json-schema'
import {z as zod} from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'
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
  return (
    looksLikeInstanceof(value, zod.ZodType as new (...args: unknown[]) => zod.ZodType) ||
    (typeof value === 'object' && value !== null && 'toJsonSchema' in value && typeof value.toJsonSchema === 'function')
  )
}

function toJsonSchema(input: JsonSchemaable): JSONSchema7 {
  const jsonSchema = 'toJsonSchema' in input ? input.toJsonSchema() : (zodToJsonSchema(input as never) as JSONSchema7)
  return Object.assign(jsonSchema, {originalSchema: input})
}

export function parseProcedureInputs(inputs: unknown[]): Result<ParsedProcedure> {
  if (inputs.length === 0) {
    return {
      success: true,
      value: {parameters: [], flagsSchema: {}, getInput: () => ({})},
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
    return parseMultiInputs(inputs.map(toJsonSchema))
  }

  const mergedSchema = toJsonSchema(inputs[0])

  if (acceptedLiteralTypes(mergedSchema).length > 0) {
    return parseLiteralInput(mergedSchema)
  }

  if (isTuple(mergedSchema)) {
    return parseTupleInput(mergedSchema)
  }

  if (isArray(mergedSchema) && acceptedLiteralTypes(mergedSchema.items as JSONSchema7).length > 0) {
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
    value: {parameters: [], flagsSchema: mergedSchema, getInput: argv => argv.flags},
  }
}

function parseLiteralInput(schema: JSONSchema7): Result<ParsedProcedure> {
  const type = acceptedLiteralTypes(schema).at(0)
  const name = schema.description || type || 'value'
  return {
    success: true,
    value: {
      // todo: pass parent `required` array to determine if optional
      parameters: [schema.type === 'ooptional' ? `[${name}]` : `<${name}>`],
      flagsSchema: {},
      getInput: argv => convertPositional(schema, argv._[0]),
    },
  }
}

function acceptedLiteralTypes(schema: JSONSchema7) {
  const candidates = ['string', 'number', 'boolean'] as const
  const acceptedJsonSchemaTypes = new Set(
    schema.oneOf
      ? schema.oneOf.map(s => (s as JSONSchema7).type)
      : schema.anyOf
        ? schema.anyOf.map(s => (s as JSONSchema7).type)
        : [schema.type],
  )
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
      parameters: [],
      flagsSchema: {
        allOf: parsedIndividually.map(p => {
          const successful = p as Extract<typeof p, {success: true}>
          return successful.value.flagsSchema
        }),
      },
      getInput: argv => argv.flags,
    },
  }
}

function isNullable(schema: JSONSchema7) {
  return Array.isArray(schema.type) && schema.type.includes('null')
}

function isTuple(schema: JSONSchema7): schema is JSONSchema7 & {items: JSONSchema7[]} {
  return Array.isArray(schema.items)
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
      parameters: [],
      flagsSchema: {},
      getInput: argv => argv._.map(s => convertPositional(array.items, s)),
    },
  }
}

function parseTupleInput(tuple: JSONSchema7 & {items: JSONSchema7[]}): Result<ParsedProcedure> {
  const nonPositionalIndex = tuple.items.findIndex(item => {
    return item.type === 'object'
  })
  const types = `[${tuple.items.map(s => s.type).join(', ')}]`

  if (nonPositionalIndex > -1 && nonPositionalIndex !== tuple.items.length - 1) {
    return {
      success: false,
      error: `Invalid input type ${types}. Positional parameters must be strings, numbers or booleans.`,
    }
  }

  const positionalSchemas =
    nonPositionalIndex === -1 ? tuple.items : (tuple.items.slice(0, nonPositionalIndex) as JSONSchema7[])

  const parameterNames = positionalSchemas.map((item, i) => parameterName(item, i + 1))
  const postionalParametersToTupleInput = (argv: {_: string[]; flags: {}}) => {
    if (positionalSchemas.length === 1 && isArray(positionalSchemas[0])) {
      const arrayItems = positionalSchemas[0].items
      return [argv._.map(s => convertPositional(arrayItems, s))]
    }
    return positionalSchemas.map((schema, i) => convertPositional(schema, argv._[i]))
  }

  if (positionalSchemas.length === tuple.items.length) {
    // all schemas were positional - no object at the end
    return {
      success: true,
      value: {
        parameters: parameterNames,
        flagsSchema: {},
        getInput: postionalParametersToTupleInput,
      },
    }
  }

  const last = tuple.items.at(-1)!

  if (!acceptsObject(last)) {
    return {
      success: false,
      error: `Invalid input type ${types}. The last type must accept object inputs.`,
    }
  }

  return {
    success: true,
    value: {
      parameters: parameterNames,
      flagsSchema: zodToJsonSchema(last),
      getInput: argv => [...postionalParametersToTupleInput(argv), argv.flags],
    },
  }
}

/**
 * Converts a positional string to parameter into a number if the target schema accepts numbers, and the input can be parsed as a number.
 * If the target schema accepts numbers but it's *not* a valid number, just return a string.
 * trpc will use zod to handle the validation before invoking the procedure.
 */
const convertPositional = (schema: JSONSchema7, value: string) => {
  let preprocessed: string | number | boolean | undefined = undefined

  const acceptedTypes = new Set(acceptedLiteralTypes(schema))
  if (acceptedTypes.has('boolean')) {
    if (value === 'true') preprocessed = true
    else if (value === 'false') preprocessed = false
  }

  if (acceptedTypes.has('number') && !schema.safeParse(preprocessed).success) {
    const number = Number(value)
    if (!Number.isNaN(number)) {
      preprocessed = Number(value)
    }
  }

  if (acceptedTypes.has('string') && !schema.safeParse(preprocessed).success) {
    // it's possible we converted to a number prematurely - need to account for `z.union([z.string(), z.number().int()])`, where 1.2 should be a string, not a number
    // in that case, we would have set preprocessed to a number, but it would fail validation, so we need to reset it to a string here
    preprocessed = value
  }

  if (preprocessed === undefined) {
    return value // we didn't convert to a number or boolean, so just return the string
  }

  if (schema.safeParse(preprocessed).success) {
    return preprocessed // we converted successfully, and the type looks good, so use the preprocessed value
  }

  if (acceptedTypes.has('string')) {
    return value // we converted successfully, but the type is wrong. However strings are also accepted, so return the string original value, it might be ok.
  }

  // we converted successfully, but the type is wrong. However, strings are also not accepted, so don't return the string original value. Return the preprocessed value even though it will fail - it's probably a number failing because of a `.refine(...)` or `.int()` or `.positive()` or `.min(1)` etc. - so better to have a "must be greater than zero" error than "expected number, got string"
  return preprocessed
}

const parameterName = (s: z.ZodType, position: number): string => {
  if (looksLikeInstanceof<z.ZodArray<never>>(s, z.ZodArray)) {
    const elementName = parameterName(s.element, position)
    return `[${elementName.slice(1, -1)}...]`
  }
  // cleye requiremenets: no special characters in positional parameters; `<name>` for required and `[name]` for optional parameters
  const name = s.description || `parameter ${position}`.replaceAll(/\W+/g, ' ').trim()
  return s.isOptional() ? `[${name}]` : `<${name}>`
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
