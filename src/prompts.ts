/* eslint-disable import-x/order */
import {Argument, Command, CommanderError, Option} from 'commander'
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

export const createShadowCommand = (command: Command, onAnalyze: (params: Analysis) => void): Command => {
  const shadow = new Command(command.name())
  shadow.exitOverride()
  shadow.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  })
  const argumentsMap = new Map<number, Shadowed<Argument>>()
  const optionsMap = new Map<number, Shadowed<Option>>()

  command.options.forEach(original => {
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

  command.registeredArguments.forEach(original => {
    const shadowArgument = new Argument(original.name(), original.description)
    const id = Date.now() + Math.random()

    shadowArgument.argOptional()
    const upstreamArgumentInfo: UpstreamArgumentInfo = {typeName: 'UpstreamArgumentInfo', id, specified: false}
    shadowArgument.default(JSON.stringify(upstreamArgumentInfo))
    shadowArgument.argParser(value => JSON.stringify({...upstreamArgumentInfo, specified: true, value}))

    shadow.addArgument(shadowArgument)
    argumentsMap.set(id, {shadow: shadowArgument, original: original})
  })

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
    onAnalyze(analysis)
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
    const nextArgv = [...argv]
    const getCommandAnalysis = async (c: Command, recursion = 0) => {
      if (recursion > 100) throw new Error('Too many recursive calls, this is probably a bug')
      const analysis = await new Promise<Analysis>((resolve, reject) => {
        const shadow = createShadowCommand(c, resolve)
        shadow.parseAsync(argv.slice(recursion), parseOptions).catch(e => {
          if (e instanceof CommanderError && e.exitCode === 0) {
            // commander tried to exit with code 0, probably rendered help - no analysis to provide
            resolve({command: {shadow, original: c}, arguments: [], options: []})
            return
          }
          reject(e as Error)
        })
      })

      if (
        analysis.arguments.length === 0 &&
        analysis.options.length === 0 &&
        analysis.command.original.commands.length > 0
      ) {
        // we've got subcommands, let's prompt the user to select one
        let currentCommand = analysis.command as Shadowed<Command> | undefined
        while (currentCommand?.original.commands && currentCommand.original.commands.length > 0) {
          const subcommand = await prompter.select(
            {
              message: 'Select a subcommand',
              choices: currentCommand.original.commands.map(child => ({
                name: child.name(),
                value: child.name(),
                description: child.description(),
              })),
            },
            {command: currentCommand.original, inputs: {argv, arguments: [], options: []}},
          )
          nextArgv.push(subcommand)
          const originalChild = currentCommand.original.commands.find(child => child.name() === subcommand)
          const shadowChild = currentCommand.shadow.commands.find(child => child.name() === subcommand)
          if (!originalChild || !shadowChild) throw new Error(`Subcommand ${subcommand} not found`)
          currentCommand = {original: originalChild, shadow: shadowChild}
        }

        if (currentCommand) return getCommandAnalysis(currentCommand.original, recursion + 1)
      }

      return analysis
    }

    const analysis = await getCommandAnalysis(command)

    const getMessage = (thing: {name: () => string; long?: string; description: string}) => {
      if (thing.description) return `[${thing.long || thing.name()}] ${thing.description}`
      return `Enter value for ${thing.name()}`
    }

    const baseContext = {
      command: analysis.command.original,
      inputs: {
        argv,
        arguments: analysis.arguments.map(a => ({name: a.original.name(), specified: a.specified, value: a.value})),
        options: analysis.options.map(o => ({name: o.original.name(), specified: o.specified, value: o.value})),
      },
    }
    // console.log('baseContext', baseContext.inputs)
    await prompter.setup?.(baseContext)

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
          nextArgv.push(fullFlag, getParsedValue(promptedValue) ?? promptedValue)
        }
      }
    }

    await prompter.teardown?.(baseContext)

    return command.parseAsync(nextArgv, parseOptions)
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
