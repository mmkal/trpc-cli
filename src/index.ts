/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as trpcServer from '@trpc/server'
import {Argument, Command, Option} from 'commander'
import colors from 'picocolors'
import {ZodError} from 'zod'
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
    const procedureInputsResult = parseProcedureInputs(procedure._def.inputs as unknown[])
    if (!procedureInputsResult.success) {
      return [procedurePath, procedureInputsResult.error] as const
    }

    const procedureInputs = procedureInputsResult.value
    const properties = flattenedProperties(procedureInputs.flagsSchema)
    const incompatiblePairs = incompatiblePropertyPairs(procedureInputs.flagsSchema)

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

    return [
      procedurePath,
      {name: procedurePath, procedure, procedureInputs, properties, incompatiblePairs, type},
    ] as const
  })

  const procedureEntries = procedures.flatMap(([k, v]) => {
    return typeof v === 'string' ? [] : [[k, v] as const]
  })

  const procedureMap = Object.fromEntries(procedureEntries)

  const ignoredProcedures = procedures.flatMap(([k, v]) => (typeof v === 'string' ? [{procedure: k, reason: v}] : []))

  async function run(runParams?: {argv?: string[]; logger?: Logger; process?: {exit: (code: number) => never}}) {
    const logger = {...lineByLineConsoleLogger, ...runParams?.logger}
    const _process = runParams?.process || process
    const verboseErrors: boolean = false

    const program = new Command()
    program.option('--verbose-errors', 'Throw raw errors (by default errors are summarised)')
    program.showHelpAfterError()
    program.showSuggestionAfterError()

    // Organize commands in a tree structure for nested subcommands
    const commandTree: Record<string, Command> = {
      '': program, // Root level
    }

    // Keep track of default commands for each parent path
    const defaultCommands: Record<
      string,
      {
        procedurePath: string
        config: (typeof procedureEntries)[0][1]
        command: Command
      }
    > = {}

    // Function to configure a command with its options and help settings
    const configureCommand = (
      command: Command,
      procedurePath: string,
      {procedure, procedureInputs, properties, incompatiblePairs}: (typeof procedureEntries)[0][1],
    ) => {
      // Configure help settings for this command
      command.showHelpAfterError().showSuggestionAfterError()

      const meta = procedure._def.meta as Partial<TrpcCliMeta> | undefined

      command.description(meta?.description || '')

      // Add positional parameters
      // procedureInputs.parameters.forEach(param => {
      //   command.argument(param)
      // })
      procedureInputs.positionalParameters.forEach(param => {
        const argument = new Argument(param.name, param.description + (param.required ? ` (required)` : ' (optional)'))
        argument.required = param.required
        argument.variadic = param.array
        command.addArgument(argument)
      })

      // Add flags
      Object.entries(properties).forEach(([propertyKey, propertyValue]) => {
        let description = getDescription(propertyValue)
        const isOptional =
          'required' in procedureInputs.flagsSchema && !procedureInputs.flagsSchema.required?.includes(propertyKey)
        if (isOptional) {
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
            // todo: check this is right
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
            option.argParser((value: string) => JSON.parse(value) as {})
            break
          }
          default: {
            // Default case (string or any other type)
            option = new Option(`${flags} <value>`, description)
          }
        }

        if (!isOptional) {
          option.makeOptionMandatory()
        }

        command.addOption(option)

        // Set default value if specified
        if (propertyValue.default !== undefined) {
          command.setOptionValueWithSource(propertyKey, propertyValue.default, 'default')
        }
      })

      // Set the action for this command
      command.action(async (...args) => {
        const options = command.opts()

        if (args.at(-2) !== options) {
          throw new Error(`Unexpected args format, second last arg is not the options object`, {cause: args})
        }
        if (args.at(-1) !== command) {
          throw new Error(`Unexpected args format, last arg is not the Command instance`, {cause: args})
        }

        // the last arg is the Command instance itself, the second last is the options object, and the other args are positional
        const positionalArgs = args.slice(0, -2)

        // Check for incompatible flag pairs
        const incompatibleMessages = incompatiblePairs
          .filter(([a, b]) => options[a] !== undefined && options[b] !== undefined)
          .map(([a, b]) => `--${a} and --${b} are incompatible and cannot be used together`)

        if (incompatibleMessages?.length) {
          die(incompatibleMessages.join('\n'), {currentCommand: command})
          return
        }

        const input = procedureInputs.getInput({positionalValues: positionalArgs, flags: options}) as never
        try {
          const result = await caller[procedurePath](input)
          if (result != null) logger.info?.(result)
          _process.exit(0)
        } catch (err) {
          throw transformError(err)
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

      // Check if this command should be the default for its parent
      const meta = commandConfig.procedure._def.meta as Partial<TrpcCliMeta> | undefined
      if (meta?.default === true) {
        configureCommand(parentCommand, procedurePath, commandConfig)
        for (let ancestor = parentCommand.parent, i = 0; ancestor && i < 10; ancestor = ancestor.parent, i++) {
          ancestor.enablePositionalOptions()
        }
        parentCommand.passThroughOptions()
        defaultCommands[parentPath] = {
          procedurePath: procedurePath,
          config: commandConfig,
          command: leafCommand,
        }
      }
    })

    // After all commands are added, generate descriptions for parent commands
    Object.entries(commandTree).forEach(([path, command]) => {
      // Skip the root command and leaf commands (which already have descriptions)
      if (path === '' || command.commands.length === 0) return

      // Get the names of all direct subcommands
      const subcommandNames = command.commands.map(cmd => cmd.name())

      // Check if there's a default command for this path
      const defaultCommand = defaultCommands[path]?.command.name()

      // Format the subcommand list, marking the default one
      const formattedSubcommands = subcommandNames
        .map(name => (name === defaultCommand ? `${name} (default)` : name))
        .join(', ')

      // Get the existing description (might have been set by a default command)
      const existingDescription = command.description() || ''

      // Only add the subcommand list if it's not already part of the description
      if (!existingDescription.includes('Available subcommands:')) {
        const baseDescription = existingDescription.replace(/\s*\(Default:.*?\)/, '').trim()
        const newDescription = baseDescription
          ? `${baseDescription}\nAvailable subcommands: ${formattedSubcommands}`
          : `Available subcommands: ${formattedSubcommands}`

        command.description(newDescription)
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
      console.log('dying', {message, cause, help, currentCommand})
      if (verboseErrors !== undefined && verboseErrors) {
        throw (cause as Error) || new Error(message)
      }
      logger.error?.(colors.red(message))
      if (help) {
        currentCommand.help()
      }
      _process.exit(11)
      throw new Error(`Failed to exit`)
    }

    program.exitOverride(error => {
      _process.exit(error.exitCode)
    })

    try {
      if (runParams?.argv) {
        await program.parseAsync(runParams.argv, {from: 'user'})
      } else {
        await program.parseAsync(process.argv)
      }
      _process.exit(0)
    } catch (err) {
      logger.error?.(colors.red(String(err)))
      _process.exit(12)
    }
  }

  return {run, ignoredProcedures}
}

/** @deprecated renamed to `createCli` */
export const trpcCli = createCli

type Fail = (message: string, options?: {cause?: unknown; help?: boolean; currentCommand?: Command}) => never

function transformError(err: unknown) {
  if (looksLikeInstanceof(err, Error) && err.message.includes('This is a client-only function')) {
    return new Error('createCallerFactory version mismatch - pass in createCallerFactory explicitly', {cause: err})
  }
  if (looksLikeInstanceof(err, trpcServer.TRPCError)) {
    const cause = err.cause
    if (err.code === 'BAD_REQUEST' && looksLikeInstanceof(cause, ZodError)) {
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

        return new Error(prettyError.message) // don't include cause
      } finally {
        cause.issues = originalIssues
      }
    }
    if (err.code === 'INTERNAL_SERVER_ERROR') {
      return cause
    }
  }
  return err
}
