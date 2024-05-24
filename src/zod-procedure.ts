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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseProcedureInputs(value: Procedure<any, any>): Result<ParsedProcedure> {
  if (value._def.inputs.length === 0) {
    return {
      success: true,
      value: {parameters: [], flagsSchema: {}, getInput: () => ({})},
    }
  }

  const zodSchema: z.ZodType =
    value._def.inputs.length === 1
      ? (value._def.inputs[0] as never)
      : (z.intersection(...(value._def.inputs as [never, never])) as never)

  if (zodSchema instanceof z.ZodTuple) {
    const tuple = zodSchema as z.ZodTuple<[z.ZodType, ...z.ZodType[]]>
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
    const getParameters = (argv: {_: string[]; flags: {}}) => {
      return positionalSchemas.map((schema, i) => {
        if (acceptsNumbers(schema)) return Number(argv._[i])
        return argv._[i]
      })
    }

    if (positionalSchemas.length === tuple.items.length) {
      // all schemas were positional - no object at the end
      return {
        success: true,
        value: {parameters: parameterNames, flagsSchema: {}, getInput: getParameters},
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
        getInput: argv => [...getParameters(argv), argv.flags],
      },
    }
  }

  if (!acceptsObject(zodSchema)) {
    return {
      success: false,
      error: `Invalid input type ${getInnerType(zodSchema).constructor.name}, expected object or tuple`,
    }
  }

  return {
    success: true,
    value: {parameters: [], flagsSchema: zodToJsonSchema(zodSchema), getInput: argv => argv.flags},
  }
}
const parameterName = (s: z.ZodType, position: number) => {
  const name = s.description || `parameter ${position}`
  return s instanceof z.ZodOptional ? `[${name}]` : `<${name}>`
}

function acceptsStrings(zodType: z.ZodType): boolean {
  const innerType = getInnerType(zodType)
  if (innerType instanceof z.ZodString) return true
  if (innerType instanceof z.ZodEnum) return (innerType.options as unknown[]).some(o => typeof o === 'string')
  if (innerType instanceof z.ZodLiteral) return typeof innerType.value === 'string'
  if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(acceptsStrings)
  if (innerType instanceof z.ZodIntersection)
    return acceptsStrings(innerType._def.left as z.ZodType) && acceptsStrings(innerType._def.right as z.ZodType)

  return false
}
function acceptsNumbers(zodType: z.ZodType): boolean {
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
