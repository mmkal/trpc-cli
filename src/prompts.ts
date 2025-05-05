/* eslint-disable import-x/order */
import {Argument, Command, Option} from 'commander'
import {CommanderProgramLike, EnquirerLike, InquirerPromptsLike, Promptable, Prompter, PromptsLike} from './types'

type UpstreamOptionInfo = {
  typeName: 'UpstreamOptionInfo'
  id: number
  specified: boolean
  value?: string
}

type UpstreamArgumentInfo = {
  typeName: 'UpstreamArgumentInfo'
  id: number
  specified: boolean
  value?: string
}

type Shadowed<T> = {original: T; shadow: T}
type WithValue<T> = Shadowed<T> & {value: string | undefined; specified: boolean}
type Analysis = {
  command: Shadowed<Command>
  arguments: WithValue<Argument>[]
  options: WithValue<Option>[]
}
const parseUpstreamOptionInfo = (value: unknown): UpstreamOptionInfo | null => {
  if (typeof value !== 'string' || !value.startsWith('{')) return null
  try {
    const info = JSON.parse(value) as UpstreamOptionInfo
    if (info.typeName !== 'UpstreamOptionInfo') return null
    return info
  } catch {
    return null
  }
}

const parseUpstreamArgumentInfo = (value: unknown): UpstreamArgumentInfo | null => {
  if (typeof value !== 'string' || !value.startsWith('{')) return null
  try {
    const info = JSON.parse(value) as UpstreamArgumentInfo
    if (info.typeName !== 'UpstreamArgumentInfo') return null
    return info
  } catch {
    return null
  }
}

const getDefaultSubcommand = (command: Command) => {
  // it'd be good if there was a better way to get the "default" subcommand
  const defaultChild = command.description().match(/Available subcommands:.* (\S+) \(default\)/)?.[1]
  return defaultChild ? command.commands.find(c => c.name() === defaultChild) : undefined
}

export const createShadowCommand = (
  command: Command,
  onAnalyze: (params: Analysis) => void | Promise<void>,
): Command => {
  const shadow = new Command(command.name())
  shadow.exitOverride()
  shadow.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  })
  const argumentsMap = new Map<number, Shadowed<Argument>>()
  const optionsMap = new Map<number, Shadowed<Option>>()

  const commandToLookForArgumentsAndOptionsIn = getDefaultSubcommand(command) || command

  if (commandToLookForArgumentsAndOptionsIn !== command) {
    // console.warn('looking for arguments and options in', commandToLookForArgumentsAndOptionsIn?.name())
  }

  commandToLookForArgumentsAndOptionsIn.options.forEach(original => {
    const id = Date.now() + Math.random()
    const shadowOption = new Option(
      original.flags.replace('<', '[').replace('>', ']'),
      JSON.stringify([`id=${id}`, original.description]),
    )
    const upstreamOptionInfo: UpstreamOptionInfo = {typeName: 'UpstreamOptionInfo', id, specified: false}
    shadowOption.default(JSON.stringify(upstreamOptionInfo))
    shadowOption.argParser(value => JSON.stringify({...upstreamOptionInfo, specified: true, value}))
    shadow.addOption(shadowOption)
    optionsMap.set(id, {shadow: shadowOption, original: original})
  })

  commandToLookForArgumentsAndOptionsIn.registeredArguments.forEach(original => {
    const shadowArgument = new Argument(original.name(), original.description)
    const id = Date.now() + Math.random()

    shadowArgument.argOptional()
    const upstreamArgumentInfo: UpstreamArgumentInfo = {typeName: 'UpstreamArgumentInfo', id, specified: false}
    shadowArgument.default(JSON.stringify(upstreamArgumentInfo))
    shadowArgument.argParser(value => JSON.stringify({...upstreamArgumentInfo, specified: true, value}))

    shadow.addArgument(shadowArgument)
    argumentsMap.set(id, {shadow: shadowArgument, original: original})
  })

  // if (command._allowUnknownOption) shadow.allowUnknownOption()
  // if (command._allowExcessArguments) shadow.allowExcessArguments()

  const analysis: Analysis = {
    command: {shadow, original: command},
    arguments: [],
    options: [],
  }

  shadow.action(async (...args) => {
    // the last arg is the Command instance itself, the second last is the options object, and the other args are positional
    const positionalValues = args.slice(0, -2)

    const options = shadow.opts()
    if (args.at(-2) !== options) {
      // This is a code bug and not recoverable. Will hopefully never happen but if commander totally changes their API this will break
      throw new Error(`Unexpected args format, second last arg is not the options object`, {cause: args})
    }
    if (args.at(-1) !== shadow) {
      // This is a code bug and not recoverable. Will hopefully never happen but if commander totally changes their API this will break
      throw new Error(`Unexpected args format, last arg is not the Command instance`, {cause: args})
    }

    positionalValues.forEach(value => {
      const argumentInfo = parseUpstreamArgumentInfo(value)
      if (argumentInfo) {
        analysis.arguments.push({
          ...argumentsMap.get(argumentInfo.id)!,
          value: argumentInfo.value,
          specified: argumentInfo.specified,
        })
      }
    })
    Object.values(options).forEach(value => {
      const upstreamOptionInfo = parseUpstreamOptionInfo(value)
      if (upstreamOptionInfo) {
        analysis.options.push({
          ...optionsMap.get(upstreamOptionInfo.id)!,
          value: upstreamOptionInfo.value,
          specified: upstreamOptionInfo.specified,
        })
      }
    })
    await onAnalyze(analysis)
  })

  command.commands.forEach(subcommand => {
    const shadowSubcommand = createShadowCommand(subcommand, onAnalyze)
    shadow.addCommand(shadowSubcommand)
  })

  return shadow
}

const inquirerPrompter = (prompts: InquirerPromptsLike): Prompter => {
  return prompts as typeof import('@inquirer/prompts') satisfies InquirerPromptsLike // the `satisfies` just makes sure it's safe to cast like this - if we accidentally add a method `@inquirer/prompts` doesn't have, this will fail.
}

const promptsPrompter = (prompts: PromptsLike): Prompter => {
  const p = prompts as typeof import('prompts')
  // weirdly prompts *demands* a name but doesn't show it anywhere, it just returns `{x: 'foo'}` instead of just returning `'foo'` 🤷
  function x<T>() {
    return (value: unknown) => (value as {x: T}).x
  }

  return {
    input: async params => {
      return p({
        name: 'x',
        type: 'text',
        message: params.message,
        validate: params.validate,
        initial: params.default,
      }).then(x<string>())
    },
    confirm: async params => {
      return p({
        name: 'x',
        type: 'confirm',
        message: params.message,
        active: params.default ? 'yes' : 'no',
      }).then(x<boolean>())
    },
    select: async params => {
      const choicesObjects = params.choices.map(c => (typeof c === 'string' ? {name: c, value: c} : c))
      return p({
        name: 'x',
        type: 'select',
        message: params.message,
        active: params.default,
        choices: choicesObjects.map(c => ({
          title: c.name || c.value,
          value: c.value,
        })),
        initial: params.default ? choicesObjects.findIndex(c => c.value === params.default) : undefined,
      }).then(x<string>())
    },
    checkbox: async params => {
      const choicesObjects = params.choices.map(c => (typeof c === 'string' ? {name: c, value: c} : c))
      return p({
        name: 'x',
        type: 'multiselect',
        message: params.message,
        choices: choicesObjects.map(c => ({
          title: c.name || c.value,
          value: c.value,
          selected: c.checked,
        })),
      }).then(x<string[]>())
    },
  }
}

const enquirerPrompter = (prompts: EnquirerLike): Prompter => {
  const enquirer = prompts as typeof import('enquirer')
  // weirdly enquirer *demands* a name but doesn't show it anywhere, it just returns `{x: 'foo'}` instead of just returning `'foo'` 🤷
  function x<T>() {
    return (value: unknown) => (value as {x: T}).x
  }

  return {
    input: async params => {
      return enquirer
        .prompt({
          type: 'input',
          name: 'x',
          message: params.message,
          validate: params.validate,
          initial: params.default as {},
        })
        .then(x<string>())
    },
    confirm: async params => {
      return enquirer
        .prompt({
          type: 'confirm',
          name: 'x',
          message: params.message,
          validate: params.validate,
          initial: params.default as {},
        })
        .then(x<boolean>())
    },
    select: async params => {
      return enquirer
        .prompt({
          type: 'select',
          name: 'x',
          message: params.message,
          // @ts-expect-error not sure why this is an error, in the IDE it infers the type correctly
          choices: params.choices.slice() as string[],
          validate: params.validate,
          initial: params.default as {},
        })
        .then(x<string>())
    },
    checkbox: async params => {
      return enquirer
        .prompt({
          type: 'multiselect',
          name: 'x',
          message: params.message,
          // @ts-expect-error not sure why this is an error, in the IDE it infers the type correctly
          choices: params.choices.slice().map(c => ({
            name: c.name,
            value: c.value,
          })),
          // validate: params.validate ? v => params.validate!([{value: v}]) : undefined,
          initial: params.choices.flatMap((c, i) => (c.checked ? [i] : [])),
        })
        .then(x<string[]>())
    },
  }
}

export const promptify = (program: CommanderProgramLike, prompts: Promptable) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  let promptsInput = prompts as any
  if (promptsInput?.default) promptsInput = promptsInput.default as never

  let prompter: Prompter
  if (typeof promptsInput === 'function' && typeof promptsInput.inject === 'function') {
    prompter = promptsPrompter(promptsInput as PromptsLike)
  } else if (promptsInput?.name === 'Enquirer') {
    prompter = enquirerPrompter(promptsInput as EnquirerLike)
  } else if (typeof promptsInput?.rawlist === 'function') {
    prompter = inquirerPrompter(promptsInput as InquirerPromptsLike)
  } else if (typeof promptsInput === 'function') {
    prompter = promptsInput(program) as Prompter // some kind of custom prompter-getter
  } else {
    prompter = promptsInput as Prompter // some kind of custom prompter
  }

  const command = program as Command
  type ParseOptions = {from: 'user' | 'node' | 'electron'}
  const analyseThenParse = async (argv: string[], parseOptions?: ParseOptions) => {
    // eslint-disable-next-line no-console
    if (parseOptions?.from === 'electron') {
      // eslint-disable-next-line no-console
      console.warn(
        `Warning: using prompts in electron mode is untested. The first two args of $0 are not available in electron mode. Assuming that the first two args of ${JSON.stringify(argv)} are electron-related and not intended for the CLI.`,
      )
    }

    if (parseOptions?.from !== 'user') {
      argv = argv.slice(2)
      parseOptions = {from: 'user'}
    }

    const f = {command, args: [...argv]} // await figureOutCommandAndArgs({command, args: [...argv]})
    const nextArgv = [...f.args]

    let analysis: Analysis | undefined = undefined
    const maxAttempts = 100
    for (let i = maxAttempts; i >= 0 && !analysis; i--) {
      // try to get analysis - we should epxect this to remain undefined only if the user hasn't specified a command. i.e. they're just running the root program
      // and are expecting to be prompted for a command.
      analysis = await new Promise<Analysis | undefined>((resolve, reject) => {
        const shadow = createShadowCommand(f.command, async an => {
          if (an.command.original.commands.length === 0) {
            // no subcommands, let's pass this on straight to the original
            resolve(an)
            return
          }
          const defaultSubcommand = getDefaultSubcommand(an.command.original)
          if (defaultSubcommand) {
            // there's a default subcommand, the original should have an action which passes through args to the default child. So we're done here.
            // note that this means no prompting if you build `yarn` with this library, and then the end-user just runs `yarn` (because there's a default subcommand)
            resolve(an)
            return
          }
          // ok, the user hasn't actually specified a subcommand, let's prompt them for one, add it on to the args
          const name = await prompter.select(
            {
              message: `Select a ${an.command.original.name() || ''} subcommand`.replace('  ', ' '),
              choices: an.command.original.commands.map(c => ({
                name: c.name(),
                value: c.name(),
                description: c.description(),
              })),
            },
            {} as never,
          )
          // push onto the _end_ of the args, because at this point we know there are no subcommands, so hopefully there are no ambiguous option/flags interfering with parsing.
          nextArgv.push(name)
          // resolve with undefined - we'll have to re-parse now that we've got a subcommand added to the args
          resolve(undefined)
        })
        shadow.parseAsync(nextArgv, parseOptions).catch(e => {
          if (e?.constructor?.name === 'CommanderError') {
            // CommanderError is thrown when user passes `--help`, or tries to use an unknown option.
            // We want to suppress the "shadow" version of this error, so just pass on no analysis and the rest of the flow will call the original program
            // with the same argument, and presumably get the same error but with more helpful output from the "real" program.
            resolve({
              command: {shadow: f.command, original: f.command},
              arguments: [],
              options: [],
            })
          } else {
            reject(e as Error)
          }
        })
      })
    }

    if (!analysis) {
      const message = `Failed to find a subcommand after ${maxAttempts} attempts - failing to avoid an infinite loop. This is probably a bug in trpc-cli.`
      throw new Error(message)
    }

    const getMessage = (argOrOpt: Argument | Option) => {
      const name = 'long' in argOrOpt ? argOrOpt.flags : `[${argOrOpt.name()}]`
      const parts = [
        name,
        argOrOpt.description,
        argOrOpt.defaultValue && `(default: ${argOrOpt.defaultValue as string})`,
        !argOrOpt.defaultValue && !argOrOpt.required && '(optional)',
      ]
      return parts.filter(Boolean).join(' ').trim() + ':'
    }

    const baseContext = {
      command: analysis.command.original,
      inputs: {
        argv,
        arguments: analysis.arguments.map(a => ({name: a.original.name(), specified: a.specified, value: a.value})),
        options: analysis.options.map(o => ({name: o.original.name(), specified: o.specified, value: o.value})),
      },
    }
    await prompter.setup?.(baseContext)

    // one day maybe consider making this more configurable by the user (or rather the package user -- the developer)
    // it's kinda complicated. rn 'necessary' means only prompt if something's unspecified and required.
    // but it'll then prompt for all unspecified args, even if they're not required.
    const promptConfig = 'necessary' as 'always' | 'never' | 'necessary'

    let shouldPrompt: boolean
    if (promptConfig === 'always') {
      shouldPrompt = true
    } else if (promptConfig === 'never') {
      shouldPrompt = false
    } else {
      promptConfig satisfies 'necessary'
      const someRequiredArgsUnspecified = analysis.arguments.some(a => a.original.required && !a.specified)
      const someRequiredOptionsUnspecified = analysis.options.some(o => o.original.required && !o.specified)
      shouldPrompt = someRequiredArgsUnspecified || someRequiredOptionsUnspecified
    }

    if (shouldPrompt) {
      for (const arg of analysis.arguments) {
        const ctx = {...baseContext, argument: arg.original}
        if (!arg.specified) {
          const parseArg =
            'parseArg' in arg.original && typeof arg.original.parseArg === 'function'
              ? (arg.original.parseArg as (value: string) => string | undefined)
              : undefined
          const promptedValue = await prompter.input(
            {
              message: getMessage(arg.original),
              required: arg.original.required,
              default: arg.value,
              validate: input => {
                try {
                  parseArg?.(input)
                  return true
                } catch (e) {
                  return `${(e as Error)?.message || (e as string)}`
                }
              },
            },
            ctx,
          )
          nextArgv.push(promptedValue)
        }
      }
      for (const option of analysis.options) {
        const ctx = {...baseContext, option: option.original}
        if (!option.specified) {
          const fullFlag = option.original.long || `--${option.original.name()}`
          const isBoolean = option.original.isBoolean() || option.original.flags.includes('[boolean]')
          if (isBoolean) {
            const promptedValue = await prompter.confirm(
              {
                message: getMessage(option.original),
                default: (option.original.defaultValue as boolean | undefined) ?? false,
              },
              ctx,
            )
            if (promptedValue) nextArgv.push(fullFlag)
          } else if (option.original.variadic && option.original.argChoices) {
            const choices = option.original.argChoices.slice()
            const results = await prompter.checkbox(
              {
                message: getMessage(option.original),
                choices: choices.map(choice => ({
                  value: choice,
                  name: choice,
                  checked: true,
                })),
              },
              ctx,
            )
            results.forEach(result => {
              if (typeof result === 'string') nextArgv.push(fullFlag, result)
            })
          } else if (option.original.argChoices) {
            const choices = option.original.argChoices.slice()
            const set = new Set(choices)
            const promptedValue = await prompter.select(
              {
                message: getMessage(option.original),
                choices,
                default: option.original.defaultValue as string,
                // required: option.original.required,
              },
              ctx,
            )
            if (set.has(promptedValue)) {
              nextArgv.push(fullFlag, promptedValue)
            }
          } else if (option.original.variadic) {
            const values: string[] = []
            do {
              const promptedValue = await prompter.input(
                {
                  message: getMessage(option.original),
                  default: option.original.defaultValue?.[values.length] as string,
                },
                ctx,
              )
              if (!promptedValue) break
              values.push(fullFlag, promptedValue)
            } while (values)
            nextArgv.push(...values)
          } else {
            // let's handle this as a string - but the `parseArg` function could turn it into a number or boolean or whatever
            const getParsedValue = (input: string) => {
              return option.original.parseArg ? option.original.parseArg(input, undefined as string | undefined) : input
            }
            const promptedValue = await prompter.input(
              {
                message: getMessage(option.original),
                default: option.value,
                required: option.original.required,
                validate: input => {
                  const parsed = getParsedValue(input)
                  if (parsed == null && input != null) return 'Invalid value'
                  return true
                },
              },
              ctx,
            )
            if (promptedValue) nextArgv.push(fullFlag, getParsedValue(promptedValue) ?? promptedValue)
          }
        }
      }
    }

    await prompter.teardown?.(baseContext)

    return f.command.parseAsync(nextArgv, parseOptions)
  }

  const parseAsync = (args: string[], parseOptions?: ParseOptions) =>
    analyseThenParse(args, parseOptions).catch(e => {
      if (e?.constructor?.name === 'ExitPromptError') return // https://github.com/SBoudrias/Inquirer.js?tab=readme-ov-file#handling-ctrlc-gracefully
      throw e
    })

  return new Proxy(program, {
    get(target, prop, receiver) {
      if (prop === 'parseAsync') return parseAsync
      return Reflect.get(target, prop, receiver) as {}
    },
  }) satisfies CommanderProgramLike
}
