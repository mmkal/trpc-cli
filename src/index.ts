/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {Procedure, Router, TRPCError, inferRouterContext, initTRPC} from '@trpc/server'
import * as cleye from 'cleye'
import colors from 'picocolors'
import {ZodError, z} from 'zod'
import ztjs, {JsonSchema7ObjectType, type JsonSchema7Type} from 'zod-to-json-schema'
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
export const trpcCli = <R extends Router<any>>({router: appRouter, context, alias}: TrpcCliParams<R>) => {
  async function run(props?: {
    argv?: string[]
    logger?: {info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void}
    process?: {exit: (code: number) => never}
  }) {
    const logger = {...console, ...props?.logger}
    const prcs = props?.process || process
    const parsedArgv = cleye.cli(
      {
        flags: {
          verboseErrors: {
            type: Boolean,
            description: `Throw raw errors (by default errors are summarised)`,
            default: false,
          },
        },
        commands: Object.entries(appRouter._def.procedures).map(([commandName, _value]) => {
          const value = _value as Procedure<any, any>
          value._def.inputs.forEach((input: unknown) => {
            if (!(input instanceof z.ZodType)) {
              throw new TypeError(`Only zod schemas are supported, got ${input?.constructor.name}`)
            }
          })
          const jsonSchema = procedureInputsToJsonSchema(value) // todo: inspect zod schema directly, don't convert to json-schema first

          const properties = flattenedProperties(jsonSchema)

          if (Object.entries(properties).length === 0) {
            // todo: disallow non-object schemas, while still allowing for no schema
            // throw new TypeError(`Schemas looking like ${Object.keys(jsonSchema).join(', ')} are not supported`)
          }

          const flags = Object.fromEntries(
            Object.entries(properties).map(([propertyKey, propertyValue]) => {
              const cleyeType = getCleyeType(propertyValue)

              let description: string | undefined = getDescription(propertyValue)
              if ('required' in jsonSchema && !jsonSchema.required?.includes(propertyKey)) {
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
            help: value.meta,
            flags: flags as {},
          })
        }) as cleye.Command[],
      },
      undefined,
      props?.argv,
    )

    let {verboseErrors, ...unknownFlags} = parsedArgv.unknownFlags
    verboseErrors ||= parsedArgv.flags.verboseErrors

    const caller = initTRPC.context<NonNullable<typeof context>>().create({}).createCallerFactory(appRouter)(context)

    const die = (message: string, {cause, help = true}: {cause?: unknown; help?: boolean} = {}) => {
      if (verboseErrors) {
        throw (cause as Error) || new Error(message)
      }
      logger.error?.(colors.red(message))
      if (help) {
        parsedArgv.showHelp()
      }
      return prcs.exit(1)
    }

    const command = parsedArgv.command as keyof typeof caller

    if (!command && parsedArgv._.length === 0) {
      return die('No command provided.')
    }

    if (!command) {
      return die(`Command "${parsedArgv._.join(' ')}" not recognised.`)
    }

    if (Object.entries(unknownFlags).length > 0) {
      const s = Object.entries(unknownFlags).length === 1 ? '' : 's'
      return die(`Unexpected flag${s}: ${Object.keys(parsedArgv.unknownFlags).join(', ')}`)
    }

    try {
      const {help, ...flags} = parsedArgv.flags
      const procedureType = appRouter._def.procedures[command]._def.mutation ? 'mutation' : 'query'
      // @ts-expect-error cleye types are dynamic
      const result = (await caller[procedureType](parsedArgv.command, flags)) as unknown
      if (result) logger.info?.(result)
      prcs.exit(0)
    } catch (err) {
      if (err instanceof TRPCError) {
        const cause = err.cause
        if (cause instanceof ZodError) {
          const originalIssues = cause.issues
          try {
            cause.issues = cause.issues.map(issue => ({
              ...issue,
              path: ['--' + issue.path[0], ...issue.path.slice(1)],
            }))

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

  return {run}
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

const getDescription = (v: JsonSchema7Type): string => {
  if ('items' in v) {
    return [getDescription(v.items as JsonSchema7Type), '(list)'].filter(Boolean).join(' ')
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

export function procedureInputsToJsonSchema(value: Procedure<any, any>): JsonSchema7Type {
  if (value._def.inputs.length === 0) return {}

  const zodSchema: z.ZodType<any> =
    value._def.inputs.length === 1
      ? (value._def.inputs[0] as never)
      : (z.intersection(...(value._def.inputs as [never, never])) as never)

  return ztjs(zodSchema)
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
      return (x: unknown) => x
    }
  }
}
