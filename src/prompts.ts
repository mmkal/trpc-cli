/* eslint-disable import-x/order */
import {Argument, Command, CommanderError, Option} from 'commander'
import {CommanderProgramLike, InquirerPromptsLike} from './types'
import {choice} from 'effect/Random'

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
    shadowOption.argParser(value => ({...upstreamOptionInfo, specified: true, value}))
    shadow.addOption(shadowOption)
    optionsMap.set(id, {shadow: shadowOption, original: original})
  })

  command.registeredArguments.forEach(original => {
    const shadowArgument = new Argument(original.name(), original.description)
    const id = Date.now() + Math.random()

    shadowArgument.argOptional()
    const upstreamArgumentInfo: UpstreamArgumentInfo = {typeName: 'UpstreamArgumentInfo', id, specified: false}
    shadowArgument.default(JSON.stringify(upstreamArgumentInfo))
    shadowArgument.argParser(value => ({...upstreamArgumentInfo, specified: true, value}))

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
    const positionalValues = args.slice(0, -2) // todo do something with these

    const options = shadow.opts()
    if (args.at(-2) !== options) {
      // This is a code bug and not recoverable. Will hopefully never happen but if commander totally changes their API this will break
      throw new Error(`Unexpected args format, second last arg is not the options object`, {cause: args})
    }
    if (args.at(-1) !== shadow) {
      // This is a code bug and not recoverable. Will hopefully never happen but if commander totally changes their API this will break
      throw new Error(`Unexpected args format, last arg is not the Command instance`, {cause: args})
    }

    JSON.stringify({positionalValues, options}, (key, value) => {
      const upstreamOptionInfo = parseUpstreamOptionInfo(value)
      if (upstreamOptionInfo) {
        analysis.options.push({
          ...optionsMap.get(upstreamOptionInfo.id)!,
          value: upstreamOptionInfo.value,
          specified: upstreamOptionInfo.specified,
        })
      }
      const upstreamArgumentInfo = parseUpstreamArgumentInfo(value)
      if (upstreamArgumentInfo) {
        analysis.arguments.push({
          ...argumentsMap.get(upstreamArgumentInfo.id)!,
          value: upstreamArgumentInfo.value,
          specified: upstreamArgumentInfo.specified,
        })
      }
      return value
    })
    onAnalyze(analysis)
    // console.log({options}, unsetValues)
  })

  command.commands.forEach(subcommand => {
    const shadowSubcommand = createShadowCommand(subcommand, onAnalyze)
    shadow.addCommand(shadowSubcommand)
  })

  return shadow
}

const enToIn = (en: typeof import('enquirer')): InquirerPromptsLike => {
  const promptX = async <P extends Omit<Parameters<typeof en.prompt>[0], 'name'>>(params: P) => {
    const {x} = await en.prompt<{x: never}>({...params, name: 'x'} as never)
    return x
  }
  return {
    input: async params => {
      return promptX({
        type: 'input',
        message: params.message,
        validate: params.validate,
        initial: params.default,
      })
    },
    confirm: async params => {
      return promptX({
        type: 'confirm',
        message: params.message,
        validate: params.validate,
        initial: params.default,
      })
    },
    select: async params => {
      return promptX({
        type: 'select',
        message: params.message,
        choices: params.choices.slice(), // enquirer does something bizarre with the input array, don't let it tamper with the original!
        validate: params.validate,
        initial: params.default,
      })
    },
    form: async params => {
      return en.prompt({
        type: 'form',
        name: 'x',
        message: params.message,
        choices: [
          {name: 'aa', message: 'ay', type: 'confirm'},
          {name: 'bb', message: 'bee', type: 'input'},
          {name: 'cc', message: 'cee', type: 'select', choices: ['foo', 'bar', 'baz']},
        ],
      })
    },
  }
}

export const promptify = (program: CommanderProgramLike, prompts: InquirerPromptsLike) => {
  prompts = enToIn(require('enquirer'))

  // prompts.form({message: 'hello'}).then(f => {
  //   console.log('f', f)
  // })
  const command = program as Command
  return {
    parseAsync: async (args: string[]) => {
      const nextArgs = [...args]
      const analysis = await new Promise<Analysis>((resolve, reject) => {
        const shadow = createShadowCommand(command, resolve)
        shadow.parseAsync(process.argv).catch(e => {
          if (e instanceof CommanderError && e.exitCode === 0) {
            // commander tried to exit with code 0, probably rendered help - no analysis to provide
            resolve({command: {shadow, original: command}, arguments: [], options: []})
            return
          }
          reject(e as Error)
        })
      })
      const getMessage = (thing: {name: () => string; description: string | undefined}) => {
        let message = `Enter value for ${thing.name()}`
        if (thing.description) message += ` (${thing.description})`
        return message
      }

      for (const arg of analysis.arguments) {
        if (!arg.specified) {
          const parseArg =
            'parseArg' in arg.original && typeof arg.original.parseArg === 'function'
              ? (arg.original.parseArg as (value: string) => string | undefined)
              : undefined
          const promptedValue = await prompts.input({
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
          })
          nextArgs.push(promptedValue)
        }
      }
      for (const option of analysis.options) {
        if (!option.specified) {
          const fullFlag = option.original.long || `--${option.original.name()}`
          const isBoolean = option.original.isBoolean() || option.original.flags.includes('[boolean]')
          if (isBoolean) {
            const promptedValue = await prompts.confirm({
              message: getMessage(option.original),
              default: (option.original.defaultValue as boolean | undefined) ?? false,
            })
            if (promptedValue) nextArgs.push(fullFlag)
          } else if (option.original.argChoices) {
            const choices = option.original.argChoices.slice()
            const set = new Set(choices)
            const promptedValue = await prompts.select({
              message: getMessage(option.original),
              choices,
              default: option.original.defaultValue,
              required: option.original.required,
            })
            if (set.has(promptedValue)) {
              nextArgs.push(fullFlag, promptedValue)
            }
          } else if (option.original.description.endsWith(' array')) {
            const values: string[] = []
            do {
              const promptedValue = await prompts.input({
                message: getMessage(option.original),
                default: option.original.defaultValue?.[values.length] as string,
              })
              if (!promptedValue) break
              values.push(fullFlag, promptedValue)
            } while (values)
            nextArgs.push(...values)
          } else {
            // let's handle this as a string - but the `parseArg` function could turn it into a number or boolean or whatever
            const getParsedValue = (input: string) => {
              return option.original.parseArg ? option.original.parseArg(input, undefined as string | undefined) : input
            }
            const promptedValue = await prompts.input({
              message: getMessage(option.original),
              default: option.value,
              required: option.original.required,
              validate: input => {
                const parsed = getParsedValue(input)
                if (parsed == null && input != null) return 'Invalid value'
                return true
              },
            })
            console.log('promptedValue', {promptedValue})
            nextArgs.push(fullFlag, getParsedValue(promptedValue) ?? promptedValue)
          }
        }
      }

      return command.parseAsync(nextArgs)
    },
    helpInformation: () => command.helpInformation(),
  } satisfies CommanderProgramLike
}
