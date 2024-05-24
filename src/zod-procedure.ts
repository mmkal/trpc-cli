import {z} from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'
import type {Result, ParsedProcedure} from './types'

function getInnerType(zodType: z.ZodType): z.ZodType {
  if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
    return getInnerType(zodType._def.innerType as z.ZodType)
  }
  if (zodType instanceof z.ZodEffects) {
    return getInnerType(zodType.innerType() as z.ZodType)
  }
  return zodType
}

export function parseProcedureInputs(inputs: unknown[]): Result<ParsedProcedure> {
  if (inputs.length === 0) {
    return {
      success: true,
      value: {parameters: [], flagsSchema: {}, getInput: () => ({})},
    }
  }

  const allZodTypes = inputs.every(input => input instanceof z.ZodType)
  if (!allZodTypes) {
    return {
      success: false,
      error: `Invalid input type ${inputs.map(s => (s as {})?.constructor.name).join(', ')}, only zod inputs are supported`,
    }
  }

  if (inputs.length > 1) {
    return parseMultiInputs(inputs as z.ZodType[])
  }

  const mergedSchema = inputs[0] as z.ZodType

  if (expectedLiteralTypes(mergedSchema).length > 0) {
    return parseLiteralInput(mergedSchema)
  }

  if (mergedSchema instanceof z.ZodTuple) {
    return parseTupleInput(mergedSchema as z.ZodTuple<never>)
  }

  if (!acceptsObject(mergedSchema)) {
    return {
      success: false,
      error: `Invalid input type ${getInnerType(mergedSchema).constructor.name}, expected object or tuple`,
    }
  }

  return {
    success: true,
    value: {parameters: [], flagsSchema: zodToJsonSchema(mergedSchema), getInput: argv => argv.flags},
  }
}

function parseLiteralInput(schema: z.ZodType<string> | z.ZodType<number>): Result<ParsedProcedure> {
  const type = expectedLiteralTypes(schema).at(0)
  const name = schema.description || type || 'value'
  return {
    success: true,
    value: {
      parameters: [schema.isOptional() ? `[${name}]` : `<${name}>`],
      flagsSchema: {},
      getInput: argv => convertPositional(schema, argv._[0]),
    },
  }
}

function expectedLiteralTypes(schema: z.ZodType) {
  const types: Array<'string' | 'number' | 'boolean'> = []
  if (acceptsBoolean(schema)) types.push('boolean')
  if (acceptsNumber(schema)) types.push('number')
  if (acceptsString(schema)) types.push('string')
  return types
}

function parseMultiInputs(inputs: z.ZodType[]): Result<ParsedProcedure> {
  const allObjects = inputs.every(acceptsObject)
  if (!allObjects) {
    return {
      success: false,
      error: `Invalid multi-input type ${inputs.map(s => getInnerType(s).constructor.name).join(', ')}. All inputs must accept object inputs.`,
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

function parseTupleInput(tuple: z.ZodTuple<[z.ZodType, ...z.ZodType[]]>): Result<ParsedProcedure> {
  const nonPositionalIndex = tuple.items.findIndex(item => expectedLiteralTypes(item).length === 0)
  const types = `[${tuple.items.map(s => getInnerType(s).constructor.name).join(', ')}]`

  if (nonPositionalIndex > -1 && nonPositionalIndex !== tuple.items.length - 1) {
    return {
      success: false,
      error: `Invalid input type ${types}. Positional parameters must be strings or numbers.`,
    }
  }

  const positionalSchemas = nonPositionalIndex === -1 ? tuple.items : tuple.items.slice(0, nonPositionalIndex)

  const parameterNames = positionalSchemas.map((item, i) => parameterName(item, i + 1))
  const postionalParametersToTupleInput = (argv: {_: string[]; flags: {}}) => {
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
 * If the target schema accepts numbers but it's *not* a valid number, just return a string - zod will handle the validation.
 */
const convertPositional = (schema: z.ZodType, value: string) => {
  let preprocessed: string | number | boolean | null = null

  const literalTypes = new Set(expectedLiteralTypes(schema))

  if (literalTypes.has('boolean')) {
    if (value === 'true') preprocessed = true
    else if (value === 'false') preprocessed = false
  }

  if (literalTypes.has('number') && !schema.safeParse(preprocessed).success) {
    preprocessed = Number(value)
  }

  if (literalTypes.has('string') && !schema.safeParse(preprocessed).success) {
    // it's possible we converted to a number prematurely - need to account for `z.union([z.string(), z.number().int()])`, where 1.2 should be a string, not a number
    // in that case, we would have set preprocessed to a number, but it would fail validation, so we need to reset it to a string here
    preprocessed = value
  }

  // if we've successfully preprocessed, use the *input* value - zod will re-parse, so we shouldn't return the parsed value - that would break if there's a `.transform(...)`
  return preprocessed !== null && schema.safeParse(preprocessed).success ? preprocessed : value
}

const parameterName = (s: z.ZodType, position: number) => {
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
export function accepts(target: z.ZodType) {
  const test = (zodType: z.ZodType): boolean => {
    const innerType = getInnerType(zodType)
    if (innerType instanceof target.constructor) return true
    if (innerType instanceof z.ZodLiteral) return target.safeParse(innerType.value).success
    if (innerType instanceof z.ZodEnum) return (innerType.options as unknown[]).some(o => target.safeParse(o).success)
    if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(test)
    if (innerType instanceof z.ZodIntersection)
      return test(innerType._def.left as z.ZodType) && test(innerType._def.right as z.ZodType)
    if (innerType instanceof z.ZodEffects) return test(innerType.innerType() as z.ZodType)
    return false
  }
  return test
}

const acceptsString = accepts(z.string())
const acceptsNumber = accepts(z.number())
const acceptsBoolean = accepts(z.boolean())
const acceptsObject = accepts(z.object({}))
