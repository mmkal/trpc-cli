import {Procedure} from '@trpc/server'
import {z} from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'
import type {Result, ParsedProcedure} from './types'

function getInnerType(zodType: z.ZodType): z.ZodType {
  if (zodType instanceof z.ZodOptional) {
    return getInnerType(zodType._def.innerType as z.ZodType)
  }
  if (zodType instanceof z.ZodNullable) {
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

  if (acceptsStrings(mergedSchema) || acceptsNumbers(mergedSchema)) {
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
  const type = acceptsNumbers(schema) ? 'number' : 'string'
  const name = schema.description || type
  return {
    success: true,
    value: {
      parameters: [schema.isOptional() ? `[${name}]` : `<${name}>`],
      flagsSchema: {},
      getInput: argv => convertPositional(schema, argv._[0]),
    },
  }
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
  const nonPositionalIndex = tuple.items.findIndex(item => !acceptsStrings(item) && !acceptsNumbers(item))
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
  if (acceptsNumbers(schema)) {
    const number = Number(value)
    // if `schema` accepts numbers, we still need to check that the passed value is a valid number - otherwise `z.union([z.string(), z.number()])` wouldn't work
    if (Number.isFinite(number)) return number
    // the `value` wasn't a valid number then `number` will be `NaN` - just return the original string, zod will handle the validation
  }
  return value
}

const parameterName = (s: z.ZodType, position: number) => {
  // cleye requiremenets: no special characters in positional parameters; `<name>` for required and `[name]` for optional parameters
  const name = s.description || `parameter ${position}`.replaceAll(/\W+/g, ' ').trim()
  return s.isOptional() ? `[${name}]` : `<${name}>`
}

function acceptsStrings(zodType: z.ZodType): zodType is z.ZodType<string> {
  const innerType = getInnerType(zodType)
  if (innerType instanceof z.ZodString) return true
  if (innerType instanceof z.ZodEnum) return (innerType.options as unknown[]).some(o => typeof o === 'string')
  if (innerType instanceof z.ZodLiteral) return typeof innerType.value === 'string'
  if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(acceptsStrings)
  if (innerType instanceof z.ZodIntersection)
    return acceptsStrings(innerType._def.left as z.ZodType) && acceptsStrings(innerType._def.right as z.ZodType)

  return false
}
function acceptsNumbers(zodType: z.ZodType): zodType is z.ZodType<number> {
  const innerType = getInnerType(zodType)
  if (innerType instanceof z.ZodNumber) return true
  if (innerType instanceof z.ZodEnum) return (innerType.options as unknown[]).some(o => typeof o === 'number')
  if (innerType instanceof z.ZodLiteral) return typeof innerType.value === 'number'
  if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(acceptsNumbers)
  if (innerType instanceof z.ZodIntersection)
    return acceptsNumbers(innerType._def.left as z.ZodType) && acceptsNumbers(innerType._def.right as z.ZodType)

  return false
}
function acceptsObject(zodType: z.ZodType): boolean {
  const innerType = getInnerType(zodType)
  if (innerType instanceof z.ZodObject) return true
  if (innerType instanceof z.ZodEffects) return acceptsObject(innerType.innerType() as z.ZodType)
  if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(acceptsObject)
  if (innerType instanceof z.ZodIntersection)
    return acceptsObject(innerType._def.left as z.ZodType) && acceptsObject(innerType._def.right as z.ZodType)
  return false
}
