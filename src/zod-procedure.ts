import {z} from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'
import type {Result, ParsedProcedure} from './types'
import {looksLikeInstanceof} from './util'

function getInnerType(zodType: z.ZodType): z.ZodType {
  if (looksLikeInstanceof(zodType, z.ZodOptional) || looksLikeInstanceof(zodType, z.ZodNullable)) {
    return getInnerType(zodType._def.innerType as z.ZodType)
  }
  if (looksLikeInstanceof(zodType, z.ZodEffects)) {
    return getInnerType(zodType.innerType() as z.ZodType)
  }
  return zodType
}

const looksLikeArray = (zodType: z.ZodType): zodType is z.ZodArray<z.ZodType> => {
  return looksLikeInstanceof<z.ZodArray<never>>(zodType, z.ZodArray)
}

export function parseProcedureInputs(inputs: unknown[]): Result<ParsedProcedure> {
  if (inputs.length === 0) {
    return {
      success: true,
      value: {
        positionalParameters: [],
        parameters: [],
        flagsSchema: {},
        getInput: () => ({}),
      },
    }
  }

  const allZodTypes = inputs.every(input =>
    looksLikeInstanceof(input, z.ZodType as new (...args: unknown[]) => z.ZodType),
  )
  if (!allZodTypes) {
    return {
      success: false,
      error: `Invalid input type ${inputs.map(s => (s as {})?.constructor.name).join(', ')}, only zod inputs are supported`,
    }
  }

  if (inputs.length > 1) {
    return parseMultiInputs(inputs)
  }

  const mergedSchema = inputs[0]

  if (acceptedLiteralTypes(mergedSchema).length > 0) {
    return parseLiteralInput(mergedSchema)
  }

  if (looksLikeInstanceof<z.ZodTuple<never>>(mergedSchema, z.ZodTuple)) {
    return parseTupleInput(mergedSchema)
  }

  if (looksLikeArray(mergedSchema) && acceptedLiteralTypes(mergedSchema.element).length > 0) {
    return parseArrayInput(mergedSchema)
  }

  if (!acceptsObject(mergedSchema)) {
    return {
      success: false,
      error: `Invalid input type ${getInnerType(mergedSchema).constructor.name}, expected object or tuple`,
    }
  }

  return {
    success: true,
    value: {
      positionalParameters: [],
      parameters: [],
      flagsSchema: zodToJsonSchema(mergedSchema),
      getInput: argv => argv.flags,
    },
  }
}

function parseLiteralInput(schema: z.ZodType<string> | z.ZodType<number>): Result<ParsedProcedure> {
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
          required: !schema.isOptional(),
          type: type!,
        },
      ],
      parameters: [schema.isOptional() ? `[${name}]` : `<${name}>`],
      flagsSchema: {},
      getInput: argv => convertPositional(schema, argv.positionalValues[0] as string),
    },
  }
}

function acceptedLiteralTypes(schema: z.ZodType) {
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
      positionalParameters: [],
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

function parseArrayInput(array: z.ZodArray<z.ZodType>): Result<ParsedProcedure> {
  if (looksLikeInstanceof(array.element, z.ZodNullable)) {
    return {
      success: false,
      error: `Invalid input type ${array.element.constructor.name}<${getInnerType(array.element).constructor.name}>[]. Nullable arrays are not supported.`,
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
          required: !array.isOptional(),
          type: 'string',
        },
      ],
      parameters: [parameterName(array, 1)],
      flagsSchema: {},
      getInput: argv => (argv.positionalValues.at(-1) as string[]).map(s => convertPositional(array.element, s)),
    },
  }
}

function parseTupleInput(tuple: z.ZodTuple<[z.ZodType, ...z.ZodType[]]>): Result<ParsedProcedure> {
  const flagsSchemaIndex = tuple.items.findIndex(item => {
    if (acceptedLiteralTypes(item).length > 0) {
      return false // it's a string, number or boolean
    }
    if (looksLikeArray(item) && acceptedLiteralTypes(item.element).length > 0) {
      return false // it's an array of strings, numbers or booleans
    }
    return true // it's not a string, number, boolean or array of strings, numbers or booleans. So it's probably a flags object
  })
  const types = `[${tuple.items.map(s => getInnerType(s).constructor.name).join(', ')}]`

  if (flagsSchemaIndex > -1 && flagsSchemaIndex !== tuple.items.length - 1) {
    return {
      success: false,
      error: `Invalid input type ${types}. Positional parameters must be strings, numbers or booleans.`,
    }
  }

  const flagsSchema = flagsSchemaIndex === -1 ? null : tuple.items[flagsSchemaIndex]

  if (flagsSchema && !acceptsObject(flagsSchema)) {
    return {
      success: false,
      error: `Invalid input type ${types}. The last type must accept object inputs.`,
    }
  }

  const positionalSchemas = flagsSchemaIndex === -1 ? tuple.items : tuple.items.slice(0, flagsSchemaIndex)

  const parameterNames = positionalSchemas.map((item, i) => parameterName(item, i + 1))

  return {
    success: true,
    value: {
      positionalParameters: positionalSchemas.map((schema, i) => ({
        name: parameterName(schema, i + 1),
        array: looksLikeArray(schema),
        description: schema.description || '',
        required: !schema.isOptional(),
        type: 'string',
      })),
      parameters: parameterNames,
      flagsSchema: flagsSchema ? zodToJsonSchema(flagsSchema) : {},
      getInput: commandArgs => {
        const inputs: unknown[] = commandArgs.positionalValues.map((v, i) => {
          const correspondingSchema = positionalSchemas[i]
          if (looksLikeArray(correspondingSchema)) {
            if (!Array.isArray(v)) {
              throw new Error(`Expected array at position ${i}, got ${typeof v}`)
            }
            return v.map(s => convertPositional(correspondingSchema.element, s))
          }
          if (typeof v !== 'string') {
            throw new Error(`Expected string at position ${i}, got ${typeof v}`)
          }
          return convertPositional(correspondingSchema, v)
        })

        if (flagsSchema) {
          inputs.push(commandArgs.flags)
        }
        return inputs
      },
    },
  }
}

/**
 * Converts a positional string to parameter into a number if the target schema accepts numbers, and the input can be parsed as a number.
 * If the target schema accepts numbers but it's *not* a valid number, just return a string.
 * trpc will use zod to handle the validation before invoking the procedure.
 */
const convertPositional = (schema: z.ZodType, value: string) => {
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
  if (looksLikeArray(s)) {
    const elementName = parameterName(s.element, position)
    return `[${elementName.slice(1, -1)}...]`
  }
  // cleye requiremenets: no special characters in positional parameters; `<name>` for required and `[name]` for optional parameters
  const name = s.description || `parameter_${position}`.replaceAll(/\W+/g, ' ').trim()
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
export function accepts<ZodTarget extends z.ZodType>(target: ZodTarget) {
  const test = (zodType: z.ZodType): boolean => {
    const innerType = getInnerType(zodType)
    if (looksLikeInstanceof(innerType, target.constructor as new (...args: unknown[]) => ZodTarget)) return true
    if (looksLikeInstanceof(innerType, z.ZodLiteral)) return target.safeParse(innerType.value).success
    if (looksLikeInstanceof(innerType, z.ZodEnum)) return innerType.options.some(o => target.safeParse(o).success)
    if (looksLikeInstanceof(innerType, z.ZodUnion)) return innerType.options.some(test)
    if (looksLikeInstanceof<z.ZodEffects<z.ZodType>>(innerType, z.ZodEffects)) return test(innerType.innerType())
    if (looksLikeInstanceof<z.ZodIntersection<z.ZodType, z.ZodType>>(innerType, z.ZodIntersection))
      return test(innerType._def.left) && test(innerType._def.right)

    return false
  }
  return test
}

const acceptsString = accepts(z.string())
const acceptsNumber = accepts(z.number())
const acceptsBoolean = accepts(z.boolean())
const acceptsObject = accepts(z.object({}))
