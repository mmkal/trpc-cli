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
  const procedures = Object.entries<AnyProcedure>(router._def.procedures as {}).map(([procedurePath, procedure]) => {
    const procedureResult = parseProcedureInputs(procedure._def.inputs as unknown[])
    if (!procedureResult.success) {
      return [procedurePath, procedureResult.error] as const
    }

    const jsonSchema = procedureResult.value
    const properties = flattenedProperties(jsonSchema.flagsSchema)
    const incompatiblePairs = incompatiblePropertyPairs(jsonSchema.flagsSchema)

    // trpc types are a bit of a lie - they claim to be `router._def.procedures.foo.bar` but really they're `router._def.procedures['foo.bar']`
    const trpcProcedure = router._def.procedures[procedurePath] as AnyProcedure
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

    return [procedurePath, {name: procedurePath, procedure, jsonSchema, properties, incompatiblePairs, type}] as const
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
      // Show help text after errors including unknown commands
      .showHelpAfterError()
      // Enable suggestions for unknown commands and options
      .showSuggestionAfterError()

    // Organize commands in a tree structure for nested subcommands
    const commandTree: Record<string, Command> = {
      '': program, // Root level
    }

    // Function to configure a command with its options and help settings
    const configureCommand = (
      command: Command,
      procedurePath: string,
      {procedure, jsonSchema, properties, incompatiblePairs}: (typeof procedureEntries)[0][1],
    ) => {
      // Configure help settings for this command
      command.showHelpAfterError().showSuggestionAfterError()

      const meta = procedure._def.meta as Partial<TrpcCliMeta> | undefined

      command.description(meta?.description || '')

      // Add positional parameters
      jsonSchema.parameters.forEach(param => command.argument(param))

      // Add flags
      Object.entries(properties).forEach(([propertyKey, propertyValue]) => {
        let description = getDescription(propertyValue)
        if ('required' in jsonSchema.flagsSchema && !jsonSchema.flagsSchema.required?.includes(propertyKey)) {
          description = `${description} (optional)`.trim()
        }

        let flags = `--${propertyKey}`
        const alias = params.alias?.(propertyKey, {command: procedurePath, flags: properties})
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
            die(incompatibleMessages.join('\n'), {currentCommand: command})
            return
          }

          // Extract positional arguments and flags
          const input = jsonSchema.getInput({_: positionalArgs, flags: options}) as never

          // Call the procedure
          const result: unknown = await (caller[procedurePath] as Function)(input)
          if (result) logger.info?.(result)
          _process.exit(0)
        } catch (err) {
          throw transformError(err, (msg, opts) => die(msg, {...opts, currentCommand: command}))
        }
      })
    }

    // Process each procedure and add as a command or subcommand
    procedureEntries.forEach(([procedurePath, commandConfig]) => {
      const segments = procedurePath.split('.')

      // Create the command path and ensure parent commands exist
      let currentPath = ''
      for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i]
        const parentPath = currentPath
        currentPath = currentPath ? `${currentPath}.${segment}` : segment

        // Create parent command if it doesn't exist
        if (!commandTree[currentPath]) {
          const parentCommand = commandTree[parentPath]
          const newCommand = new Command(segment)
            // Configure help settings for parent commands too
            .showHelpAfterError()
            .showSuggestionAfterError()
          parentCommand.addCommand(newCommand)
          commandTree[currentPath] = newCommand
        }
      }

      // Create the actual leaf command
      const leafName = segments.at(-1)
      const parentPath = segments.length > 1 ? segments.slice(0, -1).join('.') : ''
      const parentCommand = commandTree[parentPath]

      const leafCommand = new Command(leafName)
      configureCommand(leafCommand, procedurePath, commandConfig)
      parentCommand.addCommand(leafCommand)
    })

    // After all commands are added, generate descriptions for parent commands
    Object.entries(commandTree).forEach(([path, command]) => {
      // Skip the root command and leaf commands (which already have descriptions)
      if (path === '' || command.commands.length === 0) return

      // Get the names of all direct subcommands
      const subcommandNames = command.commands.map(cmd => cmd.name())

      // Set the description to show available subcommands
      if (!command.description()) {
        command.description(`Available subcommands: ${subcommandNames.join(', ')}`)
      }
    })

    type Context = NonNullable<typeof params.context>

    const createCallerFactory =
      params.createCallerFactory ||
      (trpcServer.initTRPC.context<Context>().create({}).createCallerFactory as CreateCallerFactoryLike)

    const caller = createCallerFactory(router)(params.context)

    const die: Fail = (
      message: string,
      {cause, help = true, currentCommand = program}: {cause?: unknown; help?: boolean; currentCommand?: Command} = {},
    ) => {
      if (verboseErrors !== undefined && verboseErrors) {
        throw (cause as Error) || new Error(message)
      }
      logger.error?.(colors.red(message))
      if (help) {
        currentCommand.help()
      }
      return _process.exit(1)
    }

    // Parse the arguments
    try {
      const argv = runParams?.argv || process.argv
      program.parse(argv)

      // Check for --verbose-errors flag
      verboseErrors = program.opts().verboseErrors

      // If no command was executed, check if we need to show help
      if (!commandExecuted) {
        if (argv.length > 2) {
          const commandName = argv[2]
          if (!commandName.startsWith('-')) {
            // Check if it's a known root command
            const isKnownCommand = procedureEntries.some(([name]) => name.split('.')[0] === commandName)

            if (!isKnownCommand) {
              // Get all root command names for suggestions
              const rootCommands = [...new Set(procedureEntries.map(([name]) => name.split('.')[0]))]
              const suggestions = rootCommands.length > 0 ? `\nAvailable commands: ${rootCommands.join(', ')}` : ''

              die(`Unknown command: ${commandName}${suggestions}`, {help: true})
            }
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

type Fail = (message: string, options?: {cause?: unknown; help?: boolean; currentCommand?: Command}) => never

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
