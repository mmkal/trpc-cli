import type {Readable, Writable} from 'node:stream'
import type {PromptContext, Prompter} from './types.js'

export type BuiltInPromptsOptions = {
  input?: Readable
  output?: Writable
  signal?: AbortSignal
}

class ExitPromptError extends Error {}

type ActiveReadline = {
  reader: LineReader
  output: Writable
}

type SelectChoice = {name: string; value: string; description?: string}
type CheckboxChoice = {name: string; value: string; checked?: boolean}

export const createBuiltInPrompts = (options: BuiltInPromptsOptions = {}): Prompter => {
  let active: ActiveReadline | undefined

  const createActiveReadline = (context: PromptContext): ActiveReadline => {
    const input = options.input || context.input || process.stdin
    const output = options.output || context.output || process.stdout
    const signal = options.signal || context.signal
    const reader = new LineReader(input, output, signal)
    return {reader, output}
  }

  const withReadline = async <T>(context: PromptContext, action: (readline: ActiveReadline) => Promise<T>) => {
    if (active) return action(active)
    const temporary = createActiveReadline(context)
    try {
      return await action(temporary)
    } finally {
      temporary.reader.dispose()
    }
  }

  const writeLine = (context: PromptContext, message: string) =>
    withReadline(context, async readline => {
      readline.output.write(`${message}\n`)
    })

  const writeOutput = (context: PromptContext, message: string) =>
    withReadline(context, async readline => {
      readline.output.write(message)
    })

  const writeChoices = async (
    context: PromptContext,
    choices: Array<SelectChoice | CheckboxChoice>,
    defaultIndex: number,
    selectedValues?: string[],
  ) => {
    const selected = new Set(selectedValues || [])
    const lines = choices.map((choice, index) => {
      const defaultMarker = index === defaultIndex ? '*' : ' '
      const checkboxMarker = selected.has(choice.value) ? '[x]' : '[ ]'
      const marker = selectedValues ? checkboxMarker : defaultMarker
      const description = 'description' in choice && choice.description ? ` - ${choice.description}` : ''
      return `  ${marker} ${index + 1}. ${choice.name}${description}`
    })
    await writeOutput(context, `${lines.join('\n')}\n`)
  }

  const question = (context: PromptContext, message: string) =>
    withReadline(context, async readline => {
      try {
        return await readline.reader.question(message)
      } catch (error) {
        if (looksLikePromptExit(error)) throw new ExitPromptError()
        throw error
      }
    })

  return {
    setup: async context => {
      active = createActiveReadline(context)
    },
    teardown: async () => {
      active?.reader.dispose()
      active = undefined
    },
    input: async (params, context) => {
      for (;;) {
        const suffix = params.default === undefined ? '' : ` (default: ${params.default})`
        const raw = await question(context, `${params.message}${suffix} `)
        const value = raw === '' && params.default !== undefined ? params.default : raw
        const validationMessage = getValidationMessage(value, params.validate)
        if (validationMessage) {
          await writeLine(context, validationMessage)
          continue
        }
        if (params.required && value === '') {
          await writeLine(context, 'Required')
          continue
        }
        return value
      }
    },
    confirm: async (params, context) => {
      const suffix = params.default ? ' (Y/n)' : ' (y/N)'
      for (;;) {
        const raw = (await question(context, `${params.message}${suffix} `)).trim().toLowerCase()
        if (raw === '') {
          if (typeof params.default === 'boolean') return params.default
          return false
        }
        if (['y', 'yes', 'true', '1'].includes(raw)) return true
        if (['n', 'no', 'false', '0'].includes(raw)) return false
        await writeLine(context, 'Enter yes or no')
      }
    },
    select: async (params, context) => {
      const choices = normalizeSelectChoices(params.choices)
      if (choices.length === 0) throw new Error('Cannot prompt for a selection without choices')
      const defaultIndex = Math.max(
        choices.findIndex(choice => choice.value === params.default),
        0,
      )
      await writeChoices(context, choices, defaultIndex)
      for (;;) {
        const raw = (
          await question(context, `${params.message} (1-${choices.length}, default: ${defaultIndex + 1}) `)
        ).trim()
        const selected = raw === '' ? choices[defaultIndex] : findChoice(choices, raw)
        if (selected) {
          const validationMessage = getValidationMessage(selected.value, params.validate)
          if (validationMessage) {
            await writeLine(context, validationMessage)
            continue
          }
          return selected.value
        }
        await writeLine(context, `Enter a number from 1 to ${choices.length}`)
      }
    },
    checkbox: async (params, context) => {
      const choices = params.choices.slice()
      const defaultValues = params.default || choices.flatMap(choice => (choice.checked ? [choice.value] : []))
      await writeChoices(context, choices, -1, defaultValues)
      for (;;) {
        const raw = (await question(context, `${params.message} (comma-separated numbers) `)).trim()
        const selectedValues = raw === '' ? defaultValues : parseCheckboxAnswer(choices, raw)
        if (selectedValues) {
          if (params.required && selectedValues.length === 0) {
            await writeLine(context, 'Select at least one option')
            continue
          }
          return selectedValues
        }
        await writeLine(context, `Enter numbers from 1 to ${choices.length}, separated by commas`)
      }
    },
  }
}

export const builtInPrompts = () => createBuiltInPrompts()

class LineReader {
  private buffer = ''
  private lines: string[] = []
  private waiting: Array<{resolve: (line: string) => void; reject: (error: Error) => void}> = []
  private closed = false
  private shouldPauseOnDispose: boolean

  constructor(
    private input: Readable,
    private output: Writable,
    private signal?: AbortSignal,
  ) {
    this.shouldPauseOnDispose = this.input.isPaused()
    this.input.on('data', this.onData)
    this.input.on('end', this.onEnd)
    this.input.on('error', this.onError)
    this.signal?.addEventListener('abort', this.onAbort)
    if (this.signal?.aborted) this.onAbort()
    this.input.resume()
  }

  question(message: string) {
    this.output.write(message)
    const line = this.lines.shift()
    if (line !== undefined) return Promise.resolve(line)
    if (this.closed) return Promise.reject(new ExitPromptError())
    return new Promise<string>((resolve, reject) => {
      this.waiting.push({resolve, reject})
    })
  }

  dispose() {
    this.input.off('data', this.onData)
    this.input.off('end', this.onEnd)
    this.input.off('error', this.onError)
    this.signal?.removeEventListener('abort', this.onAbort)
    if (this.shouldPauseOnDispose) this.input.pause()
  }

  private onData = (chunk: Buffer | string) => {
    this.buffer += chunk.toString()
    for (;;) {
      const lineEnd = this.buffer.indexOf('\n')
      if (lineEnd === -1) return
      const rawLine = this.buffer.slice(0, lineEnd)
      this.buffer = this.buffer.slice(lineEnd + 1)
      this.pushLine(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine)
    }
  }

  private onEnd = () => {
    if (this.buffer) {
      this.pushLine(this.buffer)
      this.buffer = ''
    }
    this.closed = true
    this.rejectWaiting(new ExitPromptError())
  }

  private onError = (error: Error) => {
    this.closed = true
    this.rejectWaiting(error)
  }

  private onAbort = () => {
    this.closed = true
    this.rejectWaiting(new ExitPromptError())
  }

  private pushLine(line: string) {
    const next = this.waiting.shift()
    if (next) {
      next.resolve(line)
      return
    }
    this.lines.push(line)
  }

  private rejectWaiting(error: Error) {
    for (;;) {
      const next = this.waiting.shift()
      if (!next) return
      next.reject(error)
    }
  }
}

const normalizeSelectChoices = (choices: string[] | SelectChoice[]): SelectChoice[] =>
  choices.map(choice => (typeof choice === 'string' ? {name: choice, value: choice} : choice))

const findChoice = (choices: SelectChoice[], raw: string) => {
  const index = Number(raw)
  if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1]
  return choices.find(choice => choice.value === raw || choice.name === raw)
}

const parseCheckboxAnswer = (choices: CheckboxChoice[], raw: string) => {
  if (raw.toLowerCase() === 'all') return choices.map(choice => choice.value)
  if (raw.toLowerCase() === 'none') return []
  const selected = new Set<string>()
  const tokens = raw.split(/[,\s]+/).filter(Boolean)
  for (const token of tokens) {
    const choice = findChoice(choices, token)
    if (!choice) return null
    selected.add(choice.value)
  }
  return choices.flatMap(choice => (selected.has(choice.value) ? [choice.value] : []))
}

const getValidationMessage = (value: string, validate: ((input: string) => boolean | string) | undefined) => {
  if (!validate) return ''
  const result = validate(value)
  if (result === true) return ''
  if (result === false) return 'Invalid input'
  return result
}

const looksLikePromptExit = (error: unknown) => {
  return error instanceof Error && ['AbortError', 'ERR_USE_AFTER_CLOSE'].includes(error.name)
}
