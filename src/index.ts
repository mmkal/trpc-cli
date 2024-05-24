/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {Procedure, Router, TRPCError, initTRPC} from '@trpc/server'
import * as cleye from 'cleye'
import colors from 'picocolors'
import {ZodError} from 'zod'
import {type JsonSchema7Type} from 'zod-to-json-schema'
import * as zodValidationError from 'zod-validation-error'
import {flattenedProperties, incompatiblePropertyPairs, getDescription} from './json-schema'
import {TrpcCliParams} from './types'
import {parseProcedureInputs} from './zod-procedure'

export * from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouter = Router<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProcedure = Procedure<any, any>

/**
 * Run a trpc router as a CLI.
 *
 * @param router A trpc router
 * @param context The context to use when calling the procedures - needed if your router requires a context
 * @param alias A function that can be used to provide aliases for flags.
 * @param default The name of the "default" command @default 'default'
 * @returns A CLI object with a `run` method that can be called to run the CLI. The `run` method will parse the command line arguments, call the appropriate trpc procedure, log the result and exit the process. On error, it will log the error and exit with a non-zero exit code.
 */
export const trpcCli = <R extends AnyRouter>({router, context, alias, default: defaultProcedure}: TrpcCliParams<R>) => {
  const procedures = Object.entries<AnyProcedure>(router._def.procedures as {}).map(([name, procedure]) => {
    const procedureResult = parseProcedureInputs(procedure._def.inputs as unknown[])
    if (!procedureResult.success) {
      return [name, procedureResult.error] as const
    }

    const jsonSchema = procedureResult.value
    const properties = flattenedProperties(jsonSchema.flagsSchema)
    const incompatiblePairs = incompatiblePropertyPairs(jsonSchema.flagsSchema)
    const type = router._def.procedures[name]._def.mutation ? 'mutation' : 'query'

    return [name, {name, procedure, jsonSchema, properties, incompatiblePairs, type}] as const
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

    const cleyeCommands = procedureEntries.map(
      ([commandName, {procedure, jsonSchema, properties}]): CleyeCommandOptions => {
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
                default: propertyValue.default as {},
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

        return {
          name: commandName,
          help: procedure.meta as {},
          parameters: jsonSchema.parameters,
          flags: flags as {},
        }
      },
    )

    const defaultCommandName = defaultProcedure === false ? {} : defaultProcedure || 'default'
    const defaultCommand = cleyeCommands.find(({name}) => name === defaultCommandName)

    const parsedArgv = cleye.cli(
      {
        flags: {
          verboseErrors: {
            type: Boolean,
            description: `Throw raw errors (by default errors are summarised)`,
            default: false,
          },
        },
        ...defaultCommand,
        commands: cleyeCommands.map(cmd => cleye.command(cmd)) as cleye.Command[],
      },
      undefined,
      params?.argv,
    )

    const {verboseErrors: _verboseErrors, ...unknownFlags} = parsedArgv.unknownFlags as Record<string, unknown>
    verboseErrors = _verboseErrors || parsedArgv.flags.verboseErrors

    const caller = initTRPC.context<NonNullable<typeof context>>().create({}).createCallerFactory(router)(context)

    const die: Fail = (message: string, {cause, help = true}: {cause?: unknown; help?: boolean} = {}) => {
      if (verboseErrors !== undefined && verboseErrors) {
        throw (cause as Error) || new Error(message)
      }
      logger.error?.(colors.red(message))
      if (help) {
        parsedArgv.showHelp()
      }
      return _process.exit(1)
    }

    const command = parsedArgv.command as string | undefined

    let procedureInfo: (typeof procedureMap)[string]
    if (command) {
      procedureInfo = procedureMap[command]
    } else if (typeof defaultCommandName === 'string') {
      procedureInfo = procedureMap[defaultCommandName]
    } else {
      die('No command provided.')
    }

    if (Object.entries(unknownFlags).length > 0) {
      const s = Object.entries(unknownFlags).length === 1 ? '' : 's'
      return die(`Unexpected flag${s}: ${Object.keys(unknownFlags).join(', ')}`)
    }

    let {help, ...flags} = parsedArgv.flags

    flags = Object.fromEntries(Object.entries(flags as {}).filter(([_k, v]) => v !== undefined)) // cleye returns undefined for flags which didn't receive a value

    const incompatibleMessages = procedureInfo.incompatiblePairs
      .filter(([a, b]) => a in flags && b in flags)
      .map(([a, b]) => `--${a} and --${b} are incompatible and cannot be used together`)

    if (incompatibleMessages?.length) {
      return die(incompatibleMessages.join('\n'))
    }

    const input = procedureInfo.jsonSchema.getInput({_: parsedArgv._, flags}) as never

    try {
      const result: unknown = await caller[procedureInfo.type as 'mutation'](procedureInfo.name, input)
      if (result) logger.info?.(result)
      _process.exit(0)
    } catch (err) {
      throw transformError(err, die)
    }
  }

  return {run, ignoredProcedures}
}

type Fail = (message: string, options?: {cause?: unknown; help?: boolean}) => never

function transformError(err: unknown, fail: Fail): unknown {
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

        return fail(prettyError.message, {cause, help: true})
      } finally {
        cause.issues = originalIssues
      }
    }
    if (err.code === 'INTERNAL_SERVER_ERROR') {
      throw cause
    }
    if (err.code === 'BAD_REQUEST') {
      return fail(err.message, {cause: err})
    }
  }
}

type CleyeCommandOptions = cleye.Command['options']
type CleyeFlag = NonNullable<CleyeCommandOptions['flags']>[string]

function getCleyeType(schema: JsonSchema7Type): Extract<CleyeFlag, {type: unknown}>['type'] {
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
