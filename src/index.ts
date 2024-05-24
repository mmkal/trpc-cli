/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {Procedure, Router, TRPCError, inferRouterContext, initTRPC} from '@trpc/server'
import * as cleye from 'cleye'
import colors from 'picocolors'
import {ZodError, z} from 'zod'
import zodToJsonSchema, {JsonSchema7ObjectType, type JsonSchema7Type} from 'zod-to-json-schema'
import * as zodValidationError from 'zod-validation-error'

export type TrpcCliParams<R extends Router<any>> = {
  router: R
  context?: inferRouterContext<R>
  alias?: (fullName: string, meta: {command: string; flags: Record<string, unknown>}) => string | undefined
}

/**
 * Optional interface for describing procedures via meta - if your router conforms to this meta shape, it will contribute to the CLI help text.
 * Based on @see `import('cleye').HelpOptions`
 */
export interface TrpcCliMeta {
  /** Version of the script displayed in `--help` output. Use to avoid enabling `--version` flag. */
  version?: string
  /** Description of the script or command to display in `--help` output. */
  description?: string
  /** Usage code examples to display in `--help` output. */
  usage?: false | string | string[]
  /** Example code snippets to display in `--help` output. */
  examples?: string | string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpcCli = <R extends Router<any>>({router, context, alias}: TrpcCliParams<R>) => {
  const procedures = Object.entries(router._def.procedures).map(([commandName, value]) => {
    const procedure = value as Procedure<any, any>
    const procedureResult = parseProcedureInputs(procedure)
    if (!procedureResult.success) {
      return [commandName, procedureResult.error] as const
    }

    const jsonSchema = procedureResult.value
    const properties = flattenedProperties(jsonSchema.flagsSchema)
    const incompatiblePairs = incompatiblePropertyPairs(jsonSchema.flagsSchema)
    const type = router._def.procedures[commandName]._def.mutation ? 'mutation' : 'query'

    return [commandName, {procedure, jsonSchema, properties, incompatiblePairs, type}] as const
  })

  const procedureEntries = procedures.flatMap(([k, v]) => {
    return typeof v === 'string' ? [] : [[k, v] as const]
  })

  const procedureMap = Object.fromEntries(procedureEntries)

  const ignoredProcedures = Object.fromEntries(
    procedures.flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as const] : [])),
  )

  async function run(params?: {
    argv?: string[]
    logger?: {info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void}
    process?: {exit: (code: number) => never}
  }) {
    const logger = {...console, ...params?.logger}
    const _process = params?.process || process
    let verboseErrors: boolean = false

    const parsedArgv = cleye.cli(
      {
        flags: {
          verboseErrors: {
            type: Boolean,
            description: `Throw raw errors (by default errors are summarised)`,
            default: false,
          },
        },
        commands: procedureEntries.map(([commandName, {procedure, jsonSchema, properties}]) => {
          const flags = Object.fromEntries(
            Object.entries(properties).map(([propertyKey, propertyValue]) => {
              const cleyeType = getCleyeType(propertyValue)

              let description: string | undefined = getDescription(propertyValue)
              if ('required' in jsonSchema.flagsSchema && !jsonSchema.flagsSchema.required?.includes(propertyKey)) {
                description = `${description} (optional)`.trim()
              }
              description ||= undefined

              return [
                propertyKey,
                {
                  type: cleyeType,
                  description,
                  default: propertyValue.default,
                },
              ]
            }),
          )

          Object.entries(flags).forEach(([fullName, flag]) => {
            const a = alias?.(fullName, {command: commandName, flags})
            if (a) {
              Object.assign(flag, {alias: a})
            }
          })

          return cleye.command({
            name: commandName,
            help: procedure.meta,
            parameters: jsonSchema.parameters,
            flags: flags as {},
          })
        }) as cleye.Command[],
      },
      undefined,
      params?.argv,
    )

    const {verboseErrors: _verboseErrors, ...unknownFlags} = parsedArgv.unknownFlags
    verboseErrors = _verboseErrors || parsedArgv.flags.verboseErrors

    const caller = initTRPC.context<NonNullable<typeof context>>().create({}).createCallerFactory(router)(context)

    function die(message: string, {cause, help = true}: {cause?: unknown; help?: boolean} = {}) {
      if (verboseErrors !== undefined && verboseErrors) {
        throw (cause as Error) || new Error(message)
      }
      logger.error?.(colors.red(message))
      if (help) {
        parsedArgv.showHelp()
      }
      return _process.exit(1)
    }

    const command = parsedArgv.command as string

    if (!command && parsedArgv._.length === 0) {
      return die('No command provided.')
    }

    if (!command) {
      return die(`Command "${parsedArgv._.join(' ')}" not recognised.`)
    }

    const procedureInfo = procedureMap[command]
    if (!procedureInfo) {
      return die(`Command "${command}" not found. Available commands: ${Object.keys(procedureMap).join(', ')}.`)
    }

    if (Object.entries(unknownFlags).length > 0) {
      const s = Object.entries(unknownFlags).length === 1 ? '' : 's'
      return die(`Unexpected flag${s}: ${Object.keys(parsedArgv.unknownFlags).join(', ')}`)
    }

    let {help, ...flags} = parsedArgv.flags

    flags = Object.fromEntries(Object.entries(flags).filter(([_k, v]) => v !== undefined)) // cleye returns undefined for flags which didn't receive a value

    const incompatibleMessages = procedureInfo.incompatiblePairs
      .filter(([a, b]) => a in flags && b in flags)
      .map(([a, b]) => `--${a} and --${b} are incompatible and cannot be used together`)

    if (incompatibleMessages?.length) {
      return die(incompatibleMessages.join('\n'))
    }

    const input = procedureInfo.jsonSchema.getInput({_: parsedArgv._, flags}) as never

    try {
      const result: unknown = await caller[procedureInfo.type as 'mutation'](parsedArgv.command, input)
      if (result) logger.info?.(result)
      _process.exit(0)
    } catch (err) {
      if (err instanceof TRPCError) {
        const cause = err.cause
        if (cause instanceof ZodError) {
          const originalIssues = cause.issues
          try {
            cause.issues = cause.issues.map(issue => {
              if (typeof issue.path[0] !== 'string') return issue
              return {
                ...issue,
                path: ['--' + issue.path[0], ...issue.path.slice(1)],
              }
            })

            const prettyError = zodValidationError.fromError(cause, {
              prefixSeparator: '\n  - ',
              issueSeparator: '\n  - ',
            })

            return die(prettyError.message, {cause, help: true})
          } finally {
            cause.issues = originalIssues
          }
        }
        if (err.code === 'INTERNAL_SERVER_ERROR') {
          throw cause
        }
        if (err.code === 'BAD_REQUEST') {
          return die(err.message, {cause: err})
        }
      }
      throw err
    }
  }

  return {run, ignoredProcedures}
}

function getCleyeType(schema: JsonSchema7Type) {
  const _type = 'type' in schema && typeof schema.type === 'string' ? schema.type : null
  switch (_type) {
    case 'string': {
      return String
    }
    case 'integer':
    case 'number': {
      return Number
    }
    case 'boolean': {
      return Boolean
    }
    case 'array': {
      return [String]
    }
    case 'object': {
      return (s: string) => JSON.parse(s) as {}
    }
    default: {
      _type satisfies 'null' | null // make sure we were exhaustive (forgot integer at one point)
      return (value: unknown) => value
    }
  }
}

const capitaliseFromCamelCase = (camel: string) => {
  const parts = camel.split(/(?=[A-Z])/)
  return capitalise(parts.map(p => p.toLowerCase()).join(' '))
}

const capitalise = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

const flattenedProperties = (sch: JsonSchema7Type): JsonSchema7ObjectType['properties'] => {
  if ('properties' in sch) {
    return sch.properties
  }
  if ('allOf' in sch) {
    return Object.fromEntries(
      sch.allOf!.flatMap(subSchema => Object.entries(flattenedProperties(subSchema as JsonSchema7Type))),
    )
  }
  if ('anyOf' in sch) {
    const isExcluded = (v: JsonSchema7Type) => Object.keys(v).join(',') === 'not'
    const entries = sch.anyOf!.flatMap(subSchema => {
      const flattened = flattenedProperties(subSchema as JsonSchema7Type)
      const excluded = Object.entries(flattened).flatMap(([name, propSchema]) => {
        return isExcluded(propSchema) ? [`--${name}`] : []
      })
      return Object.entries(flattened).map(([k, v]): [typeof k, typeof v] => {
        if (!isExcluded(v) && excluded.length > 0) {
          return [k, Object.assign({}, v, {'Do not use with': excluded}) as typeof v]
        }
        return [k, v]
      })
    })

    return Object.fromEntries(
      entries.sort((a, b) => {
        const scores = [a, b].map(([_k, v]) => (isExcluded(v) ? 0 : 1)) // Put the excluded ones first, so that `Object.fromEntries` will override them with the non-excluded ones (`Object.fromEntries([['a', 1], ['a', 2]])` => `{a: 2}`)
        return scores[0] - scores[1]
      }),
    )
  }
  return {}
}

/** For a union type, returns a list of pairs of properties which *shouldn't* be used together (because they don't appear in the same type variant) */
const incompatiblePropertyPairs = (sch: JsonSchema7Type): Array<[string, string]> => {
  const isUnion = 'anyOf' in sch
  if (!isUnion) return []

  const sets = sch.anyOf!.map(subSchema => {
    const keys = Object.keys(flattenedProperties(subSchema as JsonSchema7Type))
    return {keys, set: new Set(keys)}
  })

  const compatiblityEntries = sets.flatMap(({keys}) => {
    return keys.map(key => {
      return [key, new Set(sets.filter(other => other.set.has(key)).flatMap(other => other.keys))] as const
    })
  })
  const allKeys = sets.flatMap(({keys}) => keys)

  return compatiblityEntries.flatMap(([key, compatibleWith]) => {
    const incompatibleEntries = allKeys
      .filter(other => key < other && !compatibleWith.has(other))
      .map((other): [string, string] => [key, other])
    return incompatibleEntries
  })
}

/**
 * Tries fairly hard to build a roughly human-readable description of a json-schema type.
 * A few common properties are given special treatment, most others are just stringified and output in `key: value` format.
 */
const getDescription = (v: JsonSchema7Type): string => {
  if ('items' in v) {
    return [getDescription(v.items as JsonSchema7Type), '(array)'].filter(Boolean).join(' ')
  }
  return (
    Object.entries(v)
      .filter(([k, vv]) => {
        if (k === 'default' || k === 'additionalProperties') return false
        if (k === 'type' && typeof vv === 'string') return false
        return true
      })
      .sort(([a], [b]) => {
        const scores = [a, b].map(k => (k === 'description' ? 0 : 1))
        return scores[0] - scores[1]
      })
      .map(([k, vv], i) => {
        if (k === 'description' && i === 0) return String(vv)
        if (k === 'properties') return `Object (json formatted)`
        return `${capitaliseFromCamelCase(k)}: ${vv}`
      })
      .join('; ') || ''
  )
}

function getInnerType(zodType: z.ZodType): z.ZodType {
  if (zodType instanceof z.ZodOptional) {
    return getInnerType(zodType._def.innerType)
  }
  if (zodType instanceof z.ZodNullable) {
    return getInnerType(zodType._def.innerType)
  }
  if (zodType instanceof z.ZodEffects) {
    return getInnerType(zodType.innerType())
  }
  return zodType
}

function acceptsStrings(zodType: z.ZodType): boolean {
  const innerType = getInnerType(zodType)
  if (innerType instanceof z.ZodString) return true
  if (innerType instanceof z.ZodEnum) return (innerType.options as unknown[]).some(o => typeof o === 'string')
  if (innerType instanceof z.ZodLiteral) return typeof innerType.value === 'string'
  if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(acceptsStrings)
  if (innerType instanceof z.ZodIntersection)
    return acceptsStrings(innerType._def.left) && acceptsStrings(innerType._def.right)

  return false
}

function acceptsNumbers(zodType: z.ZodType): boolean {
  const innerType = getInnerType(zodType)
  if (innerType instanceof z.ZodNumber) return true
  if (innerType instanceof z.ZodEnum) return (innerType.options as unknown[]).some(o => typeof o === 'number')
  if (innerType instanceof z.ZodLiteral) return typeof innerType.value === 'number'
  if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(acceptsNumbers)
  if (innerType instanceof z.ZodIntersection)
    return acceptsNumbers(innerType._def.left) && acceptsNumbers(innerType._def.right)

  return false
}

function acceptsObject(zodType: z.ZodType): boolean {
  const innerType = getInnerType(zodType)
  if (innerType instanceof z.ZodObject) return true
  if (innerType instanceof z.ZodEffects) return acceptsObject(innerType.innerType())
  if (innerType instanceof z.ZodUnion) return (innerType.options as z.ZodType[]).some(acceptsObject)
  if (innerType instanceof z.ZodIntersection)
    return acceptsObject(innerType._def.left) && acceptsObject(innerType._def.right)
  return false
}

type Result<T> = {success: true; value: T} | {success: false; error: string}

export interface ParsedProcedure {
  /** positional parameters */
  parameters: string[]
  /** JSON Schema type describing the flags for the procedure */
  flagsSchema: JsonSchema7Type
  /**
   * Function for taking cleye parsed argv output and transforming it so it can be passed into the procedure
   * Needed because this function is where inspect the input schema(s) and determine how to map the argv to the input
   */
  getInput: (argv: {_: string[]; flags: {}}) => unknown
}

export function parseProcedureInputs(value: Procedure<any, any>): Result<ParsedProcedure> {
  if (value._def.inputs.length === 0) {
    return {
      success: true,
      value: {parameters: [], flagsSchema: {}, getInput: () => ({})},
    }
  }

  const zodSchema: z.ZodType<any> =
    value._def.inputs.length === 1
      ? (value._def.inputs[0] as never)
      : (z.intersection(...(value._def.inputs as [never, never])) as never)

  if (zodSchema instanceof z.ZodTuple) {
    const tuple = zodSchema as z.ZodTuple<z.ZodTupleItems>
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
