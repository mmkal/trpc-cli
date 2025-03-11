/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as trpcServer from '@trpc/server'
import {Argument, Command, Option} from 'commander'
import {ZodError} from 'zod'
import * as zodValidationError from 'zod-validation-error'
import {addCompletions} from './completions'
import {flattenedProperties, incompatiblePropertyPairs, getDescription} from './json-schema'
import {lineByLineConsoleLogger} from './logging'
import {AnyProcedure, AnyRouter, CreateCallerFactoryLike, isTrpc11Procedure} from './trpc-compat'
import {Logger, OmeletteInstanceLike, TrpcCliMeta, TrpcCliParams} from './types'
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
  completion?: OmeletteInstanceLike | (() => Promise<OmeletteInstanceLike>)
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
      // we couldn't parse the inputs into a "friendly" format, so the user will just have to pass in JSON
      return [
        procedurePath,
        {
          name: procedurePath,
          procedure: procedure,
          procedureInputs: {
            positionalParameters: [
              {name: 'json', description: 'Inputs formatted as JSON', required: true, array: false, type: 'string'},
            ],
            parameters: [],
            optionsJsonSchema: {},
            getPojoInput: parsedCliParams => JSON.parse(parsedCliParams.positionalValues[0] as string) as {},
          },
          flagJsonSchemaProperties: {},
          incompatiblePairs: [],
          type: 'mutation',
        },
      ] as typeof result
    }

    const procedureInputs = procedureInputsResult.value
    const flagJsonSchemaProperties = flattenedProperties(procedureInputs.optionsJsonSchema)
    const incompatiblePairs = incompatiblePropertyPairs(procedureInputs.optionsJsonSchema)

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

    const result = [
      procedurePath,
      {name: procedurePath, procedure, procedureInputs, flagJsonSchemaProperties, incompatiblePairs, type},
    ] as const
    return result
  })

  const procedureEntries = procedures.flatMap(([k, v]) => {
    return typeof v === 'string' ? [] : [[k, v] as const]
  })

  const ignoredProcedures = procedures.flatMap(([k, v]) => (typeof v === 'string' ? [{procedure: k, reason: v}] : []))

  function buildProgram(runParams?: TrpcCliRunParams) {
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

      if (meta.usage) command.usage([meta.usage].flat().join('\n'))
      if (meta.examples) command.addHelpText('after', `\nExamples:\n${[meta.examples].flat().join('\n')}`)

      meta?.aliases?.command?.forEach(alias => {
        command.alias(alias)
      })

      command.description(meta?.description || '')

      procedureInputs.positionalParameters.forEach(param => {
        const argument = new Argument(param.name, param.description + (param.required ? ` (required)` : ''))
        argument.required = param.required
        argument.variadic = param.array
        command.addArgument(argument)
      })

      const unusedFlagAliases: Record<string, string> = {...meta.aliases?.flags}
      Object.entries(flagJsonSchemaProperties).forEach(([propertyKey, propertyValue]) => {
        let description = getDescription(propertyValue)
        const propertyType = 'type' in propertyValue ? propertyValue.type : null
        const isRequired =
          'required' in procedureInputs.optionsJsonSchema &&
          procedureInputs.optionsJsonSchema.required?.includes(propertyKey) &&
          ![propertyType].flat().includes('boolean')
        if (isRequired) {
          description = `${description} (required)`.trim()
        }

        let flags = `--${propertyKey}`
        const alias = meta.aliases?.flags?.[propertyKey]
        if (alias) {
          let prefix = '-'
          if (alias.startsWith('-')) prefix = ''
          else if (alias.length > 1) prefix = '--'

          flags = `${prefix}${alias}, ${flags}`
          delete unusedFlagAliases[propertyKey]
        }

        let option: Option

        // eslint-disable-next-line unicorn/prefer-switch
        if (propertyType === 'string') {
          option = new Option(`${flags} <string>`, description)
        } else if (propertyType === 'boolean') {
          option = new Option(flags, description)
        } else if (propertyType === 'number' || propertyType === 'integer') {
          option = new Option(`${flags} <number>`, description)
        } else if (propertyType === 'array') {
          option = new Option(`${flags} <values...>`, description)
        } else if (Array.isArray(propertyType)) {
          const canBeBoolean = propertyType.includes('boolean')
          if (canBeBoolean && propertyType.length === 2) {
            option = new Option(`${flags} [value]`, description)
          }
        }
        option ||= new Option(`${flags} [json]`, description)

        if (option.flags.includes('<')) {
          option.makeOptionMandatory()
        }

        option.conflicts(
          incompatiblePairs.flatMap(pair => {
            const filtered = pair.filter(p => p !== propertyKey)
            if (filtered.length === pair.length) return []
            return filtered
          }),
        )

        const acceptsBoolean = option.isBoolean() || option.flags.match(/\[.*]$/)

        if ('default' in propertyValue) {
          option.default(propertyValue.default)
        } else if (acceptsBoolean) {
          option.default(false)
        }

        if (acceptsBoolean && option.defaultValue) {
          option = new Option(`--no-${propertyKey}`, `Negate \`${propertyKey}\` property ${description || ''}`.trim())
        }

        command.addOption(option)
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
        const positionalValues = args.slice(0, -2)

        const input = procedureInputs.getPojoInput({positionalValues, options})
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
      const descriptionParts = [existingDescription, `Available subcommands: ${formattedSubcommands}`]

      command.description(descriptionParts.filter(Boolean).join('\n'))
    })

    type Context = NonNullable<typeof params.context>

    const createCallerFactory =
      params.createCallerFactory ||
      (trpcServer.initTRPC.context<Context>().create({}).createCallerFactory as CreateCallerFactoryLike)

    const caller = createCallerFactory(router)(params.context)

    return program
  }

  async function run(runParams?: TrpcCliRunParams) {
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

    if (runParams?.completion) {
      const completion =
        typeof runParams.completion === 'function' ? await runParams.completion() : runParams.completion
      addCompletions(program, completion)
    }

    await program.parseAsync(runParams?.argv || process.argv, opts).catch(err => {
      const message = looksLikeInstanceof(err, Error) ? err.message : `Non-error of type ${typeof err} thrown: ${err}`
      logger.error?.(message)
      _process.exit(1)
      throw new FailedToExitError(`Program parse catch block`, {cause: err})
    })
    _process.exit(0)
    throw new FailedToExitError('Program exit', {cause: new Error('Program exit after successful run')})
  }

  return {run, ignoredProcedures, buildProgram}
}

function getMeta(procedure: AnyProcedure): Omit<TrpcCliMeta, 'cliMeta'> {
  const meta: Partial<TrpcCliMeta> | undefined = procedure._def.meta
  return meta?.cliMeta || meta || {}
}

class FailedToExitError extends Error {
  constructor(message: string, {cause}: {cause: unknown}) {
    super(
      `${message}. An error was thrown but the process did not exit. This may be because a custom \`process\` parameter was used. The exit reason is in the \`cause\` property.`,
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
