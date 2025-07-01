/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as trpcServer11 from '@trpc/server'
import {Argument, Command as BaseCommand, InvalidArgumentError, InvalidOptionArgumentError, Option} from 'commander'
import {inspect} from 'util'
import {JsonSchema7Type} from 'zod-to-json-schema'
import {addCompletions} from './completions'
import {FailedToExitError, CliValidationError} from './errors'
import {commandToJSON} from './json'
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
import {
  AnyProcedure,
  AnyRouter,
  CreateCallerFactoryLike,
  isOrpcRouter,
  OrpcRouterLike,
  Trpc10RouterLike,
  Trpc11RouterLike,
} from './trpc-compat'
import {ParsedProcedure, TrpcCli, TrpcCliMeta, TrpcCliParams, TrpcCliRunParams} from './types'
import {looksLikeInstanceof} from './util'

export * from './types'

export {z} from 'zod/v4'
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

export {type AnyRouter, type AnyProcedure} from './trpc-compat'

/**
 * @internal takes a trpc router and returns an object that you **could** use to build a CLI, or UI, or a bunch of other things with.
 * Officially, just internal for building a CLI. GLHF.
 */
// todo: maybe refactor to remove CLI-specific concepts like "positional parameters" and "options". Libraries like trpc-ui want to do basically the same thing, but here we handle lots more validation libraries and edge cases. We could share.
export const parseRouter = <R extends AnyRouter>({router, ...params}: TrpcCliParams<R>) => {
  if (isOrpcRouter(router)) return parseOrpcRouter({router, ...params})

  return parseTrpcRouter({router, ...params})
}

const parseTrpcRouter = <R extends Trpc10RouterLike | Trpc11RouterLike>({router, ...params}: TrpcCliParams<R>) => {
  const defEntries = Object.entries<AnyProcedure>(router._def.procedures as {})
  return defEntries.map(([procedurePath, procedure]): [string, ProcedureInfo] => {
    const meta = getMeta(procedure)
    if (meta.jsonInput) {
      return [procedurePath, {meta, parsedProcedure: jsonProcedureInputs(), incompatiblePairs: [], procedure}]
    }
    const procedureInputsResult = parseProcedureInputs(procedure._def.inputs as unknown[], params)
    if (!procedureInputsResult.success) {
      const procedureInputs = jsonProcedureInputs(
        `procedure's schema couldn't be converted to CLI arguments: ${procedureInputsResult.error}`,
      )
      return [procedurePath, {meta, parsedProcedure: procedureInputs, incompatiblePairs: [], procedure}]
    }

    const procedureInputs = procedureInputsResult.value
    const incompatiblePairs = incompatiblePropertyPairs(procedureInputs.optionsJsonSchema)

    return [procedurePath, {meta: getMeta(procedure), parsedProcedure: procedureInputs, incompatiblePairs, procedure}]
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseOrpcRouter = <R extends OrpcRouterLike<any>>(params: TrpcCliParams<R>) => {
  const entries: [string, ProcedureInfo][] = []

  const {traverseContractProcedures, isProcedure} = eval(`require('@orpc/server')`) as typeof import('@orpc/server')
  const router = params.router as import('@orpc/server').AnyRouter
  const lazyRoutes = traverseContractProcedures({path: [], router}, ({contract, path}) => {
    let procedure: Record<string, unknown> = params.router
    for (const p of path) procedure = procedure[p] as Record<string, unknown>
    if (!isProcedure(procedure)) return // if it's contract-only, we can't run it via CLI (user may have passed an implemented contract router? should we tell them? it's undefined behaviour so kinda on them)

    const procedureInputsResult = parseProcedureInputs([contract['~orpc'].inputSchema], {
      '@valibot/to-json-schema': params['@valibot/to-json-schema'],
      effect: params.effect,
    })
    const procedurePath = path.join('.')
    const procedureish = {_def: {meta: contract['~orpc'].meta}} as AnyProcedure
    const meta = getMeta(procedureish)

    if (meta.jsonInput) {
      entries.push([procedurePath, {meta, parsedProcedure: jsonProcedureInputs(), incompatiblePairs: [], procedure}])
      return
    }
    if (!procedureInputsResult.success) {
      const parsedProcedure = jsonProcedureInputs(
        `procedure's schema couldn't be converted to CLI arguments: ${procedureInputsResult.error}`,
      )
      entries.push([procedurePath, {meta, parsedProcedure: parsedProcedure, incompatiblePairs: [], procedure}])
      return
    }

    const parsedProcedure = procedureInputsResult.value
    const incompatiblePairs = incompatiblePropertyPairs(parsedProcedure.optionsJsonSchema)

    entries.push([procedurePath, {procedure, meta, incompatiblePairs, parsedProcedure}])
  })
  if (lazyRoutes.length) {
    const suggestion = `Please use \`import {unlazyRouter} from '@orpc/server'\` to unlazy the router before passing it to trpc-cli`
    const routes = lazyRoutes.map(({path}) => path.join('.')).join(', ')
    throw new Error(`Lazy routers are not supported. ${suggestion}. Lazy routes detected: ${routes}`)
  }
  return entries
}

/** helper to create a "ParsedProcedure" that just accepts a JSON string - for when we failed to parse the input schema or the use set jsonInput: true */
const jsonProcedureInputs = (reason?: string): ParsedProcedure => {
  let description = `Input formatted as JSON`
  if (reason) description += ` (${reason})`
  return {
    positionalParameters: [],
    optionsJsonSchema: {
      type: 'object',
      properties: {
        input: {description}, // omit `type` - this is json input, it could be anything
      },
    },
    getPojoInput: parsedCliParams => parsedCliParams.options.input,
  }
}

type ProcedureInfo = {
  meta: TrpcCliMeta
  parsedProcedure: ParsedProcedure
  incompatiblePairs: [string, string][]
  procedure: {}
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
    const program = new Command(params.name)

    if (params.version) program.version(params.version)
    if (params.description) program.description(params.description)
    if (params.usage) [params.usage].flat().forEach(usage => program.usage(usage))

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
      {meta, parsedProcedure, incompatiblePairs, procedure}: ProcedureInfo,
    ) => {
      const optionJsonSchemaProperties = flattenedProperties(parsedProcedure.optionsJsonSchema)
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

      parsedProcedure.positionalParameters.forEach(param => {
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

        const rootTypes = getSchemaTypes(propertyValue).sort()

        const parseJson = (value: string, ErrorClass: new (message: string) => Error = InvalidArgumentError) => {
          try {
            return JSON.parse(value) as {}
          } catch {
            throw new ErrorClass(`Malformed JSON.`)
          }
        }
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
            type: 'object',
            parser: (value: string) => {
              const parsed = parseJson(value)
              if (!types.length) return parsed // if types is empty, it means any type is allowed - e.g. for json input
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
          'required' in parsedProcedure.optionsJsonSchema &&
          parsedProcedure.optionsJsonSchema.required?.includes(propertyKey)
        const isCliOptionRequired = isValueRequired && propertyType !== 'boolean' && !defaultValue.exists

        function negate() {
          const negation = new Option(longOption.replace('--', '--no-'), `Negate \`${longOption}\` option.`.trim())
          command.addOption(negation)
        }

        const bracketise = (name: string) => (isCliOptionRequired ? `<${name}>` : `[${name}]`)

        if (rootTypes.length === 2 && rootTypes[0] === 'boolean' && rootTypes[1] === 'string') {
          const option = new Option(`${flags} [value]`, description)
          option.default(defaultValue.exists ? defaultValue.value : false)
          command.addOption(option)
          negate()
          return
        }
        if (rootTypes.length === 2 && rootTypes[0] === 'boolean' && rootTypes[1] === 'number') {
          const option = new Option(`${flags} [value]`, description)
          option.argParser(getValueParser(rootTypes).parser!)
          option.default(defaultValue.exists ? defaultValue.value : false)
          command.addOption(option)
          negate()
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
          const option = new Option(`${flags} ${bracketise('json')}`, description)
          option.argParser(getValueParser(rootTypes).parser!)
          command.addOption(option)
          return
        }

        if (propertyType === 'boolean' && isValueRequired) {
          const option = new Option(flags, description)
          option.default(defaultValue.exists ? defaultValue.value : false)
          command.addOption(option)
          negate()
          return
        } else if (propertyType === 'boolean') {
          const option = new Option(`${flags} [boolean]`, description)
          option.argParser(value => booleanParser(value))
          // don't set a default value of `false`, because `undefined` is accepted by the procedure
          if (defaultValue.exists) option.default(defaultValue.value)
          command.addOption(option)
          negate()
          return
        }

        let option: Option | null = null

        // eslint-disable-next-line unicorn/prefer-switch
        if (propertyType === 'string' && 'format' in propertyValue && (propertyValue.format as string) === 'json') {
          // option = new Option(`${flags} ${bracketise('json')}`, description)
          // option.argParser(value => parseJson(value, InvalidOptionArgumentError))
        } else if (propertyType === 'string') {
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
        if (!option) {
          option = new Option(`${flags} [json]`, description)
          option.argParser(value => parseJson(value, InvalidOptionArgumentError))
        }
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
        if (propertyType === 'boolean') negate() // just in case we refactor the code above and don't handle booleans as a special case
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

        const input = parsedProcedure.getPojoInput({positionalValues, options})
        const resolvedTrpcServer = await (params.trpcServer || trpcServer11)

        let caller: Record<string, (input: unknown) => unknown>
        const deprecatedCreateCaller = Reflect.get(params, 'createCallerFactory') as CreateCallerFactoryLike | undefined
        if (deprecatedCreateCaller) {
          const message = `Using deprecated \`createCallerFactory\` option. Use \`trpcServer\` instead. e.g. \`createCli({router: myRouter, trpcServer: import('@trpc/server')})\``
          logger.error?.(message)
          caller = deprecatedCreateCaller(router)(params.context)
        } else if (isOrpcRouter(router)) {
          const {call} = eval(`require('@orpc/server')`) as typeof import('@orpc/server')
          // create an object which acts enough like a trpc caller to be used for this specific procedure
          caller = {[procedurePath]: (_input: unknown) => call(procedure as never, _input, {context: params.context})}
        } else {
          const createCallerFactor = resolvedTrpcServer.initTRPC.create().createCallerFactory as CreateCallerFactoryLike
          caller = createCallerFactor(router)(params.context)
        }

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

  return {run, buildProgram, toJSON: (program = buildProgram()) => commandToJSON(program as Command)}
}

function getMeta(procedure: {_def: {meta?: {}}}): Omit<TrpcCliMeta, 'cliMeta'> {
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
