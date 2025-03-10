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

type TrpcCliRunParams = {
  argv?: string[]
  logger?: Logger
  process?: {
    exit: (code: number) => never
  }
}

type CommanderProgramLike = {
  parseAsync: (args: string[], options?: {from: 'user' | 'node' | 'electron'}) => Promise<unknown>
}

export interface TrpcCli {
  run: (params?: TrpcCliRunParams) => Promise<void>
  buildProgram: (params?: TrpcCliRunParams) => CommanderProgramLike
  ignoredProcedures: {procedure: string; reason: string}[]
}

/**
 * Run a trpc router as a CLI.
 *
 * @param router A trpc router
 * @param context The context to use when calling the procedures - needed if your router requires a context
 * @returns A CLI object with a `run` method that can be called to run the CLI. The `run` method will parse the command line arguments, call the appropriate trpc procedure, log the result and exit the process. On error, it will log the error and exit with a non-zero exit code.
 */
export function createCli<R extends AnyRouter>({router, ...params}: TrpcCliParams<R>): TrpcCli {
  const procedures = Object.entries<AnyProcedure>(router._def.procedures as {}).map(([procedurePath, procedure]) => {
    const procedureInputsResult = parseProcedureInputs(procedure._def.inputs as unknown[])
    if (!procedureInputsResult.success) {
      return [procedurePath, procedureInputsResult.error] as const
    }

    const procedureInputs = procedureInputsResult.value
    const flagJsonSchemaProperties = flattenedProperties(procedureInputs.flagsSchema)
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
      {name: procedurePath, procedure, procedureInputs, flagJsonSchemaProperties, incompatiblePairs, type},
    ] as const
  })

  const procedureEntries = procedures.flatMap(([k, v]) => {
    return typeof v === 'string' ? [] : [[k, v] as const]
  })

  const ignoredProcedures = procedures.flatMap(([k, v]) => (typeof v === 'string' ? [{procedure: k, reason: v}] : []))

  function buildProgram(runParams?: {logger?: Logger; process?: {exit: (code: number) => never}}) {
    const logger = {...lineByLineConsoleLogger, ...runParams?.logger}
    const program = new Command()
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

    const _process = runParams?.process || process
    const configureCommand = (
      command: Command,
      procedurePath: string,
      {procedure, procedureInputs, flagJsonSchemaProperties, incompatiblePairs}: (typeof procedureEntries)[0][1],
    ) => {
      command.exitOverride(ec => {
        _process.exit(ec.exitCode)
        throw new FailedToExitError(`Command ${command.name()} exitOverride`, {cause: ec})
      })
      command.configureOutput({
        writeErr: str => {
          logger.error?.(str)
        },
      })
      command.showHelpAfterError()

      const meta = getMeta(procedure)

      meta?.aliases?.command?.forEach(alias => {
        command.alias(alias)
      })

      command.description(meta?.description || '')

      procedureInputs.positionalParameters.forEach(param => {
        const argument = new Argument(param.name, param.description + (param.required ? ` (required)` : ' (optional)'))
        argument.required = param.required
        argument.variadic = param.array
        command.addArgument(argument)
      })

      const unusedFlagAliases: Record<string, string> = {...meta.aliases?.flags}
      Object.entries(flagJsonSchemaProperties).forEach(([propertyKey, propertyValue]) => {
        let description = getDescription(propertyValue)
        const isRequired =
          'required' in procedureInputs.flagsSchema && procedureInputs.flagsSchema.required?.includes(propertyKey)
        if (!isRequired) {
          description = `${description} (optional)`.trim()
        }

        let flags = `--${propertyKey}`
        const alias = meta.aliases?.flags?.[propertyKey]
        if (alias && alias.length !== 1) {
          throw new Error(`Flag alias must be a single character, got ${alias} for flag ${propertyKey}`)
        }
        if (alias) {
          flags = `-${alias}, ${flags}`
          delete unusedFlagAliases[propertyKey]
        }

        const propertyType = 'type' in propertyValue ? propertyValue.type : null
        let option: Option

        switch (propertyType) {
          case 'string': {
            option = new Option(`${flags} <string>`, description)
            break
          }
          case 'boolean': {
            // For boolean flags, no value required
            option = new Option(flags, description)
            break
          }
          case 'number':
          case 'integer': {
            // For number flags, use a custom parser
            option = new Option(`${flags} <number>`, description)
            option.argParser(val => {
              const number = Number(val)
              if (Number.isNaN(number)) return val

              return number
            })
            break
          }
          case 'array': {
            // For array flags, collect values
            // todo: check this is right
            option = new Option(`${flags} <values...>`, description)
            option.argParser((value: string, previous: string[] = []) => {
              previous.push(value)
              return previous
            })
            break
          }
          default: {
            // For any other flags, parse as JSON
            option = new Option(`${flags} <json>`, description)
            option.argParser((value: string) => JSON.parse(value) as {})
            break
          }
        }

        if (isRequired) {
          option.makeOptionMandatory()
        }

        command.addOption(option)

        // Set default value if specified
        if (propertyValue.default !== undefined) {
          command.setOptionValueWithSource(propertyKey, propertyValue.default, 'default')
        }
      })

      const invalidFlagAliases = Object.entries(unusedFlagAliases).map(([flag, alias]) => `${flag}: ${alias}`)
      if (invalidFlagAliases.length) {
        throw new Error(`Invalid flag aliases: ${invalidFlagAliases.join(', ')}`)
      }

      // Set the action for this command
      command.action(async (...args) => {
        const options = command.opts()

        if (args.at(-2) !== options) {
          // This is a code bug and not recoverable. Will hopefully never happen but if commander totally changes their API this will break
          throw new Error(`Unexpected args format, second last arg is not the options object`, {cause: args})
        }
        if (args.at(-1) !== command) {
          // This is a code bug and not recoverable. Will hopefully never happen but if commander totally changes their API this will break
          throw new Error(`Unexpected args format, last arg is not the Command instance`, {cause: args})
        }

        // the last arg is the Command instance itself, the second last is the options object, and the other args are positional
        const positionalArgs = args.slice(0, -2)

        // Check for incompatible flag pairs
        const incompatibleMessages = incompatiblePairs
          .filter(([a, b]) => options[a] !== undefined && options[b] !== undefined)
          .map(([a, b]) => `--${a} and --${b} are incompatible and cannot be used together`)

        if (incompatibleMessages?.length) {
          command.showHelpAfterError()
          throw new Error(incompatibleMessages.join('\n'))
        }

        const input = procedureInputs.getInput({positionalValues: positionalArgs, flags: options}) as never
        const result = await (caller[procedurePath](input) as Promise<unknown>).catch(err => {
          throw transformError(err, command)
        })
        if (result != null) logger.info?.(result)
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
          newCommand.showHelpAfterError()
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
      const meta = getMeta(commandConfig.procedure)
      if (meta.default === true) {
        // this is the default command for the parent, so just configure the parent command to do the same action
        configureCommand(parentCommand, procedurePath, commandConfig)

        // ancestors need to support positional options to pass through the positional args
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

    return program
  }

  async function run(runParams?: {argv?: string[]; logger?: Logger; process?: {exit: (code: number) => never}}) {
    const _process = runParams?.process || process
    const logger = {...lineByLineConsoleLogger, ...runParams?.logger}
    const program = buildProgram(runParams)
    program.exitOverride(exit => {
      _process.exit(exit.exitCode)
      throw new FailedToExitError('Root command exitOverride', {cause: exit})
    })
    program.configureOutput({
      writeErr: str => logger.error?.(str),
    })
    const opts = runParams?.argv ? ({from: 'user'} as const) : undefined
    await program.parseAsync(runParams?.argv || process.argv, opts).catch(err => {
      const message = looksLikeInstanceof(err, Error) ? err.message : `Non-error of type ${typeof err} thrown: ${err}`
      logger.error?.(message)
      _process.exit(1)
      throw new FailedToExitError(`Program parse catch block`, {cause: err})
    })
    _process.exit(0)
  }

  return {run, ignoredProcedures, buildProgram}
}

function getMeta(procedure: AnyProcedure): Omit<TrpcCliMeta, 'cliMeta'> {
  const meta: Partial<TrpcCliMeta> | undefined = procedure._def.meta
  return meta?.cliMeta || meta || {}
}

class FailedToExitError extends Error {
  constructor(message: string, {cause}: {cause?: unknown}) {
    super(
      message +
        '. An error was thrown but the process did not exit. This may be because a custom `process` parameter was used. The Previous error is in the `cause`.',
      {cause},
    )
  }
}

/** @deprecated renamed to `createCli` */
export const trpcCli = createCli

function transformError(err: unknown, command: Command) {
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

        const validationError = zodValidationError.fromError(cause, {
          prefixSeparator: '\n  - ',
          issueSeparator: '\n  - ',
        })

        return new ValidationError(validationError.message + '\n\n' + command.helpInformation()) // don't include cause
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

class ValidationError extends Error {}
