/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as trpcServer11 from '@trpc/server'
import {Argument, Command as BaseCommand, InvalidArgumentError, Option} from 'commander'
import {inspect} from 'util'
import {type ZodError as Zod3Error} from 'zod'
import {JsonSchema7Type} from 'zod-to-json-schema'
import {addCompletions} from './completions'
import {FailedToExitError, CliValidationError} from './errors'
import {
  flattenedProperties,
  incompatiblePropertyPairs,
  getDescription,
  getSchemaTypes,
  getEnumChoices,
} from './json-schema'
import {lineByLineConsoleLogger} from './logging'
import {parseProcedureInputs} from './parse-procedure'
import {promptify} from './prompts'
import {prettifyStandardSchemaError} from './standard-schema/errors'
import {looksLikeStandardSchemaFailure} from './standard-schema/utils'
import {AnyProcedure, AnyRouter, CreateCallerFactoryLike, isTrpc11Procedure} from './trpc-compat'
import {TrpcCli, TrpcCliMeta, TrpcCliParams, TrpcCliRunParams} from './types'
import {looksLikeInstanceof} from './util'

export * from './types'

export {z} from 'zod'
export * as zod from 'zod'

export * as trpcServer from '@trpc/server'

export class Command extends BaseCommand {
  /** @internal track the commands that have been run, so that we can find the `__result` of the last command */
  __ran: Command[] = []
  __input?: unknown
  /** @internal stash the return value of the underlying procedure on the command so to pass to `FailedToExitError` for use in a pinch */
  __result?: unknown
}

/** re-export of the @trpc/server package, just to avoid needing to install manually when getting started */

// eslint-disable-next-line @typescript-eslint/no-explicit-any

export {AnyRouter, AnyProcedure} from './trpc-compat'

/**
 * @internal takes a trpc router and returns an object that you **could** use to build a CLI, or UI, or a bunch of other things with.
 * Officially, just internal for building a CLI. GLHF.
 */
// todo: maybe refactor to remove CLI-specific concepts like "positional parameters" and "options". Libraries like trpc-ui want to do basically the same thing, but here we handle lots more validation libraries and edge cases. We could share.
export const parseRouter = <R extends AnyRouter>({router, ...params}: TrpcCliParams<R>) => {
  const procedures = Object.entries<AnyProcedure>(router._def.procedures as {}).map(([procedurePath, procedure]) => {
    const procedureInputsResult = parseProcedureInputs(procedure._def.inputs as unknown[], {
      '@valibot/to-json-schema': params['@valibot/to-json-schema'],
      effect: params.effect,
    })
    // trpc types are a bit of a lie - they claim to be `router._def.procedures.foo.bar` but really they're `router._def.procedures['foo.bar']`
    let type: 'mutation' | 'query' | 'subscription'
    if (isTrpc11Procedure(procedure)) {
      type = procedure._def.type
    } else if (procedure._def.mutation) {
      type = 'mutation'
    } else if (procedure._def.query) {
      type = 'query'
    } else if (procedure._def.subscription) {
      type = 'subscription'
    } else {
      const keys = Object.keys(procedure._def).join(', ')
      throw new Error(`Unknown procedure type for procedure object with keys ${keys}`)
    }

    if (getMeta(procedure).jsonInput || !procedureInputsResult.success) {
      return [
        procedurePath,
        {
          name: procedurePath,
          procedure,
          meta: getMeta(procedure),
          procedureInputs: {
            positionalParameters: [],
            optionsJsonSchema: {
              type: 'object',
              properties: {
                input: {
                  type: 'json' as string as 'string',
                  description: `Input formatted as JSON${procedureInputsResult.success ? '' : ` (procedure's schema couldn't be converted to CLI arguments: ${procedureInputsResult.error})`}`,
                },
              },
            },
            getPojoInput: parsedCliParams => {
              if (parsedCliParams.options.input == null) return parsedCliParams.options.input
              return JSON.parse(parsedCliParams.options.input as string) as {}
            },
          },
          incompatiblePairs: [],
          type,
        },
      ] as typeof result
    }

    const procedureInputs = procedureInputsResult.value
    const incompatiblePairs = incompatiblePropertyPairs(procedureInputs.optionsJsonSchema)

    const result = [
      procedurePath,
      {name: procedurePath, meta: getMeta(procedure), procedureInputs, incompatiblePairs, type, procedure},
    ] as const
    return result
  })

  const procedureEntries = procedures.flatMap(([k, v]) => {
    return typeof v === 'string' ? [] : [[k, v] as const]
  })

  return procedureEntries
}

/**
 * Run a trpc router as a CLI.
 *
 * @param router A trpc router
 * @param context The context to use when calling the procedures - needed if your router requires a context
 * @param trpcServer The trpc server module to use. Only needed if using trpc v10.
 * @returns A CLI object with a `run` method that can be called to run the CLI. The `run` method will parse the command line arguments, call the appropriate trpc procedure, log the result and exit the process. On error, it will log the error and exit with a non-zero exit code.
 */
export function createCli<R extends AnyRouter>({router, ...params}: TrpcCliParams<R>): TrpcCli {
  const procedureEntries = parseRouter({router, ...params})

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
      {meta, procedureInputs, incompatiblePairs}: (typeof procedureEntries)[0][1],
    ) => {
      const optionJsonSchemaProperties = flattenedProperties(procedureInputs.optionsJsonSchema)
      command.exitOverride(ec => {
        _process.exit(ec.exitCode)
        throw new FailedToExitError(`Command ${command.name()} exitOverride`, {exitCode: ec.exitCode, cause: ec})
      })
      command.configureOutput({
        writeOut: str => {
          logger.info?.(str)
        },
        writeErr: str => {
          logger.error?.(str)
        },
      })
      command.showHelpAfterError()

      if (meta.usage) command.usage([meta.usage].flat().join('\n'))
      if (meta.examples) command.addHelpText('after', `\nExamples:\n${[meta.examples].flat().join('\n')}`)

      meta?.aliases?.command?.forEach(alias => {
        command.alias(alias)
      })

      command.description(meta?.description || '')

      procedureInputs.positionalParameters.forEach(param => {
        const descriptionParts = [
          param.type === 'string' ? '' : param.type, // "string" is the default assumption, don't bother showing it
          param.description,
          param.required ? '(required)' : '',
        ]
        const argument = new Argument(param.name, descriptionParts.filter(Boolean).join(' '))
        if (param.type === 'number') {
          argument.argParser(value => {
            const number = numberParser(value, {fallback: null})
            if (number == null) throw new InvalidArgumentError(`Invalid number: ${value}`)
            return value
          })
        }
        argument.required = param.required
        argument.variadic = param.array
        command.addArgument(argument)
      })

      const unusedOptionAliases: Record<string, string> = {...meta.aliases?.options}
      const addOptionForProperty = ([propertyKey, propertyValue]: [string, JsonSchema7Type]) => {
        const description = getDescription(propertyValue)

        const longOption = `--${kebabCase(propertyKey)}`
        let flags = longOption
        const alias = meta.aliases?.options?.[propertyKey]
        if (alias) {
          let prefix = '-'
          if (alias.startsWith('-')) prefix = ''
          else if (alias.length > 1) prefix = '--'

          flags = `${prefix}${alias}, ${flags}`
          delete unusedOptionAliases[propertyKey]
        }

        const defaultValue =
          'default' in propertyValue
            ? ({exists: true, value: propertyValue.default} as const)
            : ({exists: false} as const)

        if (defaultValue.value === true) {
          const negation = new Option(
            longOption.replace('--', '--no-'),
            `Negate \`${longOption}\` option. ${description || ''}`.trim(),
          )
          command.addOption(negation)
        }

        const rootTypes = getSchemaTypes(propertyValue).sort()

        /** try to get a parser that can confidently parse a string into the correct type. Returns null if it can't confidently parse */
        const getValueParser = (types: ReturnType<typeof getSchemaTypes>) => {
          types = types.map(t => (t === 'integer' ? 'number' : t))
          if (types.length === 2 && types[0] === 'boolean' && types[1] === 'number') {
            return {
              type: 'boolean|number',
              parser: (value: string) => booleanParser(value, {fallback: null}) ?? numberParser(value),
            } as const
          }
          if (types.length === 1 && types[0] === 'boolean') {
            return {type: 'boolean', parser: (value: string) => booleanParser(value)} as const
          }
          if (types.length === 1 && types[0] === 'number') {
            return {type: 'number', parser: (value: string) => numberParser(value)} as const
          }
          if (types.length === 1 && types[0] === 'string') {
            return {type: 'string', parser: null} as const
          }
          return {
            type: 'json',
            parser: (value: string) => {
              let parsed: unknown
              try {
                parsed = JSON.parse(value) as {}
              } catch {
                throw new InvalidArgumentError(`Malformed JSON.`)
              }
              const jsonSchemaType = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed
              if (!types.includes(jsonSchemaType)) {
                throw new InvalidArgumentError(`Got ${jsonSchemaType} but expected ${types.join(' or ')}`)
              }
              return parsed
            },
          } as const
        }

        const propertyType = rootTypes[0]
        const isValueRequired =
          'required' in procedureInputs.optionsJsonSchema &&
          procedureInputs.optionsJsonSchema.required?.includes(propertyKey)
        const isCliOptionRequired = isValueRequired && propertyType !== 'boolean' && !defaultValue.exists

        const bracketise = (name: string) => (isCliOptionRequired ? `<${name}>` : `[${name}]`)

        if (rootTypes.length === 2 && rootTypes[0] === 'boolean' && rootTypes[1] === 'string') {
          const option = new Option(`${flags} [value]`, description)
          option.default(defaultValue.exists ? defaultValue.value : false)
          command.addOption(option)
          return
        }
        if (rootTypes.length === 2 && rootTypes[0] === 'boolean' && rootTypes[1] === 'number') {
          const option = new Option(`${flags} [value]`, description)
          option.argParser(getValueParser(rootTypes).parser!)
          option.default(defaultValue.exists ? defaultValue.value : false)
          command.addOption(option)
          return
        }
        if (rootTypes.length === 2 && rootTypes[0] === 'number' && rootTypes[1] === 'string') {
          const option = new Option(`${flags} ${bracketise('value')}`, description)
          option.argParser(value => {
            const number = numberParser(value, {fallback: null})
            return number ?? value
          })
          if (defaultValue.exists) option.default(defaultValue.value)
          command.addOption(option)
          return
        }

        if (rootTypes.length !== 1) {
          const option = new Option(`${flags} ${bracketise('json')}`, `${description} (value will be parsed as JSON)`)
          option.argParser(getValueParser(rootTypes).parser!)
          command.addOption(option)
          return
        }

        if (propertyType === 'boolean' && isValueRequired) {
          const option = new Option(flags, description)
          option.default(defaultValue.exists ? defaultValue.value : false)
          command.addOption(option)
          return
        }
        if (propertyType === 'boolean' && !isValueRequired) {
          const option = new Option(`${flags} [boolean]`, description)
          option.argParser(value => booleanParser(value))
          // don't set a default value of `false`, because `undefined` is accepted by the procedure
          if (defaultValue.exists) option.default(defaultValue.value)
          command.addOption(option)
          return
        }

        let option: Option

        // eslint-disable-next-line unicorn/prefer-switch
        if (propertyType === 'string') {
          option = new Option(`${flags} ${bracketise('string')}`, description)
        } else if (propertyType === 'boolean') {
          option = new Option(flags, description)
        } else if (propertyType === 'number' || propertyType === 'integer') {
          option = new Option(`${flags} ${bracketise('number')}`, description)
          option.argParser(value => numberParser(value, {fallback: null}))
        } else if (propertyType === 'array') {
          option = new Option(`${flags} [values...]`, description)
          if (defaultValue.exists) option.default(defaultValue.value)
          else if (isValueRequired) option.default([])
          const itemsProp = 'items' in propertyValue ? (propertyValue.items as JsonSchema7Type) : null
          const itemTypes = itemsProp ? getSchemaTypes(itemsProp) : []

          const itemEnumTypes = itemsProp && getEnumChoices(itemsProp)
          if (itemEnumTypes?.type === 'string_enum') {
            option.choices(itemEnumTypes.choices)
          }

          const itemParser = getValueParser(itemTypes)
          if (itemParser.parser) {
            option.argParser((value, previous) => {
              const parsed = itemParser.parser(value)
              if (Array.isArray(previous)) return [...previous, parsed] as unknown[]
              return [parsed] as unknown[]
            })
          }
        }
        option ||= new Option(`${flags} [json]`, description)
        if (defaultValue.exists && option.defaultValue !== defaultValue.value) {
          option.default(defaultValue.value)
        }

        if (option.flags.includes('<')) {
          option.makeOptionMandatory()
        }

        const enumChoices = getEnumChoices(propertyValue)
        if (enumChoices?.type === 'string_enum') {
          option.choices(enumChoices.choices)
        }

        option.conflicts(
          incompatiblePairs.flatMap(pair => {
            const filtered = pair.filter(p => p !== propertyKey)
            if (filtered.length === pair.length) return []
            return filtered
          }),
        )

        command.addOption(option)
      }

      Object.entries(optionJsonSchemaProperties).forEach(addOptionForProperty)

      const invalidOptionAliases = Object.entries(unusedOptionAliases).map(([option, alias]) => `${option}: ${alias}`)
      if (invalidOptionAliases.length) {
        throw new Error(`Invalid option aliases: ${invalidOptionAliases.join(', ')}`)
      }

      // Set the action for this command
      command.action(async (...args) => {
        program.__ran ||= []
        program.__ran.push(command)
        const options = command.opts()
        // console.dir({options, args}, {depth: null})

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
        const resolvedTrpcServer = await (params.trpcServer || trpcServer11)

        const deprecatedCreateCaller = Reflect.get(params, 'createCallerFactory') as CreateCallerFactoryLike | undefined
        if (deprecatedCreateCaller) {
          const message = `Using deprecated \`createCallerFactory\` option. Use \`trpcServer\` instead. e.g. \`createCli({router: myRouter, trpcServer: import('@trpc/server')})\``
          logger.error?.(message)
        }

        const createCallerFactory =
          deprecatedCreateCaller ||
          (resolvedTrpcServer.initTRPC.create().createCallerFactory as CreateCallerFactoryLike)
        const caller = createCallerFactory(router)(params.context)

        const result = await (caller[procedurePath](input) as Promise<unknown>).catch(err => {
          throw transformError(err, command)
        })
        command.__result = result
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
          const newCommand = new Command(kebabCase(segment))
          newCommand.showHelpAfterError()
          parentCommand.addCommand(newCommand)
          commandTree[currentPath] = newCommand
        }
      }

      // Create the actual leaf command
      const leafName = segments.at(-1)
      const parentPath = segments.length > 1 ? segments.slice(0, -1).join('.') : ''
      const parentCommand = commandTree[parentPath]

      const leafCommand = new Command(leafName && kebabCase(leafName))
      configureCommand(leafCommand, procedurePath, commandConfig)
      parentCommand.addCommand(leafCommand)

      // Check if this command should be the default for its parent
      const meta = commandConfig.meta
      if (meta.default === true) {
        // the parent will pass on its args straight to the child, which will validate them. the parent just blindly accepts anything.
        parentCommand.allowExcessArguments()
        parentCommand.allowUnknownOption()
        parentCommand.addHelpText('after', leafCommand.helpInformation())
        parentCommand.action(async () => {
          await leafCommand.parseAsync([...parentCommand.args], {from: 'user'})
        })

        // ancestors need to support positional options to pass through the positional args
        // for (let ancestor = parentCommand.parent, i = 0; ancestor && i < 10; ancestor = ancestor.parent, i++) {
        //   ancestor.enablePositionalOptions()
        // }
        // parentCommand.passThroughOptions()

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
      // if (path === '' || command.commands.length === 0) return
      if (command.commands.length === 0) return

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

    return program
  }

  const run: TrpcCli['run'] = async (runParams?: TrpcCliRunParams, program = buildProgram(runParams)) => {
    if (!looksLikeInstanceof<Command>(program, 'Command')) throw new Error(`program is not a Command instance`)
    const opts = runParams?.argv ? ({from: 'user'} as const) : undefined
    const argv = [...(runParams?.argv || process.argv)]

    const _process = runParams?.process || process
    const logger = {...lineByLineConsoleLogger, ...runParams?.logger}

    program.exitOverride(exit => {
      _process.exit(exit.exitCode)
      throw new FailedToExitError('Root command exitOverride', {exitCode: exit.exitCode, cause: exit})
    })
    program.configureOutput({
      writeOut: str => logger.info?.(str),
      writeErr: str => logger.error?.(str),
    })

    if (runParams?.completion) {
      const completion =
        typeof runParams.completion === 'function' ? await runParams.completion() : runParams.completion
      addCompletions(program, completion)
    }

    const formatError =
      runParams?.formatError ||
      ((err: unknown) => {
        if (err instanceof CliValidationError) {
          return err.message
        }
        return inspect(err)
      })

    if (runParams?.prompts) {
      program = promptify(program, runParams.prompts) as Command
    }

    await program.parseAsync(argv, opts).catch(err => {
      if (err instanceof FailedToExitError) throw err
      const logMessage = looksLikeInstanceof(err, Error)
        ? formatError(err) || err.message
        : `Non-error of type ${typeof err} thrown: ${err}`
      logger.error?.(logMessage)
      _process.exit(1)
      throw new FailedToExitError(`Program exit after failure`, {exitCode: 1, cause: err})
    })
    _process.exit(0)
    throw new FailedToExitError('Program exit after success', {
      exitCode: 0,
      cause: (program as Command).__ran.at(-1)?.__result,
    })
  }

  return {run, buildProgram}
}

function getMeta(procedure: AnyProcedure): Omit<TrpcCliMeta, 'cliMeta'> {
  const meta: Partial<TrpcCliMeta> | undefined = procedure._def.meta
  return meta?.cliMeta || meta || {}
}

function kebabCase(propName: string) {
  return propName.replaceAll(/([A-Z])/g, '-$1').toLowerCase()
}

/** @deprecated renamed to `createCli` */
export const trpcCli = createCli

function transformError(err: unknown, command: Command) {
  if (looksLikeInstanceof(err, Error) && err.message.includes('This is a client-only function')) {
    return new Error(
      'Failed to create trpc caller. If using trpc v10, either upgrade to v11 or pass in the `@trpc/server` module to `createCli` explicitly',
    )
  }

  if (looksLikeInstanceof<trpcServer11.TRPCError>(err, 'TRPCError')) {
    const cause = err.cause
    if (looksLikeStandardSchemaFailure(cause)) {
      const prettyMessage = prettifyStandardSchemaError(cause)
      return new CliValidationError(prettyMessage + '\n\n' + command.helpInformation())
    }

    if (
      err.code === 'BAD_REQUEST' &&
      (err.cause?.constructor?.name === 'TraversalError' || // arktype error
        err.cause?.constructor?.name === 'StandardSchemaV1Error') // valibot error
    ) {
      return new CliValidationError(err.cause.message + '\n\n' + command.helpInformation())
    }
    if (err.code === 'INTERNAL_SERVER_ERROR') {
      return cause
    }
  }
  return err
}

export {FailedToExitError, CliValidationError} from './errors'

const numberParser = (val: string, {fallback = val as unknown} = {}) => {
  const number = Number(val)
  return Number.isNaN(number) ? fallback : number
}

const booleanParser = (val: string, {fallback = val as unknown} = {}) => {
  if (val === 'true') return true
  if (val === 'false') return false
  return fallback
}
