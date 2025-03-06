/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as trpcServer from '@trpc/server'
import {Command, Option} from 'commander'
import colors from 'picocolors'
import {ZodError} from 'zod'
import {type JsonSchema7Type} from 'zod-to-json-schema'
import * as zodValidationError from 'zod-validation-error'
import {flattenedProperties, incompatiblePropertyPairs, getDescription} from './json-schema'
import {lineByLineConsoleLogger} from './logging'
import {AnyProcedure, AnyRouter, CreateCallerFactoryLike, isTrpc11Procedure} from './trpc-compat'
import {Logger, TrpcCliMeta, TrpcCliParams} from './types'
import {looksLikeInstanceof} from './util'
import {parseProcedureInputs} from './zod-procedure'

export * from './types'

export {z} from 'zod'
export * as zod from 'zod'

export * as trpcServer from '@trpc/server'

/** re-export of the @trpc/server package, just to avoid needing to install manually when getting started */

// eslint-disable-next-line @typescript-eslint/no-explicit-any

export {AnyRouter, AnyProcedure} from './trpc-compat'

export interface TrpcCli {
  run: (params?: {argv?: string[]; logger?: Logger; process?: {exit: (code: number) => never}}) => Promise<void>
  ignoredProcedures: {procedure: string; reason: string}[]
}

/**
 * Run a trpc router as a CLI.
 *
 * @param router A trpc router
 * @param context The context to use when calling the procedures - needed if your router requires a context
 * @param alias A function that can be used to provide aliases for flags.
 * @param default A procedure to use as the default command when the user doesn't specify one.
 * @returns A CLI object with a `run` method that can be called to run the CLI. The `run` method will parse the command line arguments, call the appropriate trpc procedure, log the result and exit the process. On error, it will log the error and exit with a non-zero exit code.
 */
export function createCli<R extends AnyRouter>({router, ...params}: TrpcCliParams<R>): TrpcCli {
  const procedures = Object.entries<AnyProcedure>(router._def.procedures as {}).map(([name, procedure]) => {
    const procedureResult = parseProcedureInputs(procedure._def.inputs as unknown[])
    if (!procedureResult.success) {
      return [name, procedureResult.error] as const
    }

    const jsonSchema = procedureResult.value
    const properties = flattenedProperties(jsonSchema.flagsSchema)
    const incompatiblePairs = incompatiblePropertyPairs(jsonSchema.flagsSchema)

    // trpc types are a bit of a lie - they claim to be `router._def.procedures.foo.bar` but really they're `router._def.procedures['foo.bar']`
    const trpcProcedure = router._def.procedures[name] as AnyProcedure
    let type: 'mutation' | 'query' | 'subscription'
    if (isTrpc11Procedure(trpcProcedure)) {
      type = trpcProcedure._def.type
    } else if (trpcProcedure._def.mutation) {
      type = 'mutation'
    } else if (trpcProcedure._def.query) {
      type = 'query'
    } else if (trpcProcedure._def.subscription) {
      type = 'subscription'
    } else {
      const keys = Object.keys(trpcProcedure._def).join(', ')
      throw new Error(`Unknown procedure type for procedure object with keys ${keys}`)
    }

    return [name, {name, procedure, jsonSchema, properties, incompatiblePairs, type}] as const
  })

  const procedureEntries = procedures.flatMap(([k, v]) => {
    return typeof v === 'string' ? [] : [[k, v] as const]
  })

  const procedureMap = Object.fromEntries(procedureEntries)

  const ignoredProcedures = procedures.flatMap(([k, v]) => (typeof v === 'string' ? [{procedure: k, reason: v}] : []))

  async function run(runParams?: {argv?: string[]; logger?: Logger; process?: {exit: (code: number) => never}}) {
    const logger = {...lineByLineConsoleLogger, ...runParams?.logger}
    const _process = runParams?.process || process
    let verboseErrors: boolean = false

    // Track if any command has been executed
    let commandExecuted = false

    // Setup the main program with Commander
    const program = new Command()
      .option('--verbose-errors', 'Throw raw errors (by default errors are summarised)')
      .helpOption('-h, --help', 'Show help')

    const defaultCommands: string[] = []

    // Process each procedure and add as a command
    procedureEntries.forEach(([commandName, {procedure, jsonSchema, properties, incompatiblePairs}]) => {
      const meta = procedure._def.meta as Partial<TrpcCliMeta> | undefined

      // Check if this is a default command
      if (meta?.default) {
        defaultCommands.push(commandName)
      }

      // Create the command
      const command = new Command(commandName).description(meta?.description || '')

      // Add positional parameters
      if (jsonSchema.parameters.length > 0) {
        jsonSchema.parameters.forEach(param => {
          // Convert parameter format like <parameter 1> or [parameter 2] to suitable format for Commander
          const required = param.startsWith('<') && param.endsWith('>')
          const name = param.slice(1, -1)
          if (required) {
            command.argument(`<${name}>`, `${name}`)
          } else {
            command.argument(`[${name}]`, `${name}`)
          }
        })
      }

      // Add flags
      Object.entries(properties).forEach(([propertyKey, propertyValue]) => {
        let description = getDescription(propertyValue)
        if ('required' in jsonSchema.flagsSchema && !jsonSchema.flagsSchema.required?.includes(propertyKey)) {
          description = `${description} (optional)`.trim()
        }

        let flags = `--${propertyKey}`
        const alias = params.alias?.(propertyKey, {command: commandName, flags: properties})
        if (alias) {
          flags = `-${alias}, ${flags}`
        }

        const propertyType = 'type' in propertyValue ? propertyValue.type : null
        let option: Option

        switch (propertyType) {
          case 'boolean': {
            // For boolean flags, no value required
            option = new Option(flags, description)
            break
          }
          case 'number':
          case 'integer': {
            // For number flags, use a custom parser
            option = new Option(`${flags} <value>`, description)
            option.argParser(Number)
            break
          }
          case 'array': {
            // For array flags, collect values
            option = new Option(`${flags} <value>`, description)
            option.argParser((value: string, previous: string[] = []) => {
              previous.push(value)
              return previous
            })
            break
          }
          case 'object': {
            // For object flags, parse as JSON
            option = new Option(`${flags} <json>`, description)
            option.argParser((value: string) => JSON.parse(value))
            break
          }
          default: {
            // Default case (string or any other type)
            option = new Option(`${flags} <value>`, description)
          }
        }

        command.addOption(option)

        // Set default value if specified
        if (propertyValue.default !== undefined) {
          command.setOptionValueWithSource(propertyKey, propertyValue.default, 'default')
        }
      })

      // Set the action for this command
      command.action(async (...args) => {
        try {
          commandExecuted = true

          // Commander passes params differently than cleye
          // The last argument is the Command instance itself, and we need to extract options from it
          const options = args.at(-1)?.opts() || {}

          // All other args are positional
          const positionalArgs = args.slice(0, -1)

          // Check for incompatible flag pairs
          const incompatibleMessages = incompatiblePairs
            .filter(([a, b]) => options[a] !== undefined && options[b] !== undefined)
            .map(([a, b]) => `--${a} and --${b} are incompatible and cannot be used together`)

          if (incompatibleMessages?.length) {
            die(incompatibleMessages.join('\n'))
            return
          }

          // Extract positional arguments and flags
          const input = jsonSchema.getInput({_: positionalArgs, flags: options}) as never

          // Call the procedure
          const result: unknown = await (caller[commandName] as Function)(input)
          if (result) logger.info?.(result)
          _process.exit(0)
        } catch (err) {
          throw transformError(err, die)
        }
      })

      // Add the command to the program
      program.addCommand(command)
    })

    if (defaultCommands.length > 1) {
      throw new Error(
        `multiple commands have \`default: true\` - only one command can be the default: ${defaultCommands.join(',')}`,
      )
    }

    const defaultCommand = defaultCommands[0] || params.default?.procedure

    if (params.default) {
      logger.error?.(
        'default has been deprecated - add a `default: true` flag to the command you want to be the default',
      )
    }

    type Context = NonNullable<typeof params.context>

    const createCallerFactory =
      params.createCallerFactory ||
      (trpcServer.initTRPC.context<Context>().create({}).createCallerFactory as CreateCallerFactoryLike)

    const caller = createCallerFactory(router)(params.context)

    const die: Fail = (message: string, {cause, help = true}: {cause?: unknown; help?: boolean} = {}) => {
      if (verboseErrors !== undefined && verboseErrors) {
        throw (cause as Error) || new Error(message)
      }
      logger.error?.(colors.red(message))
      if (help) {
        program.help()
      }
      return _process.exit(1)
    }

    // Parse the arguments
    try {
      // Handle the case where no command is provided but there's a default
      const argv = runParams?.argv || process.argv

      // If we have a default command and the first non-option argument isn't a command, insert it
      if (defaultCommand && argv.length > 2) {
        const firstArg = argv[2]
        const isOption = firstArg.startsWith('-')
        const isKnownCommand = procedureEntries.some(([name]) => name === firstArg)

        if (!isOption && !isKnownCommand) {
          // This is a positional argument, not a command or option, so we need to insert the default command
          const newArgv = [...argv.slice(0, 2), defaultCommand, ...argv.slice(2)]
          program.parse(newArgv)
        } else if (isOption) {
          // This is an option, so we need to insert the default command
          const newArgv = [...argv.slice(0, 2), defaultCommand, ...argv.slice(2)]
          program.parse(newArgv)
        } else {
          // Normal case, parse as-is
          program.parse(argv)
        }
      } else if (defaultCommand && argv.length === 2) {
        // No args provided but we have a default command
        program.parse([...argv, defaultCommand])
      } else {
        // Normal case, parse as-is
        program.parse(argv)
      }

      // Check for --verbose-errors flag
      verboseErrors = program.opts().verboseErrors

      // If no command was executed, check if we need to show help
      if (!commandExecuted) {
        if (argv.length > 2) {
          const commandName = argv[2]
          const isKnownCommand = procedureEntries.some(([name]) => name === commandName)

          if (!isKnownCommand && !commandName.startsWith('-')) {
            die(`Unknown command: ${commandName}`)
          }
        } else {
          die('No command specified.')
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        die(err.message, {cause: err})
      } else {
        die(String(err))
      }
    }
  }

  return {run, ignoredProcedures}
}

/** @deprecated renamed to `createCli` */
export const trpcCli = createCli

type Fail = (message: string, options?: {cause?: unknown; help?: boolean}) => never

function transformError(err: unknown, fail: Fail): unknown {
  if (looksLikeInstanceof(err, Error) && err.message.includes('This is a client-only function')) {
    return new Error('createCallerFactory version mismatch - pass in createCallerFactory explicitly', {cause: err})
  }
  if (looksLikeInstanceof(err, trpcServer.TRPCError)) {
    const cause = err.cause
    if (looksLikeInstanceof(cause, ZodError)) {
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
  return err
}
