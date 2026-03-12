import {CliTable} from './cli-table.js'
import {Log, Logger} from './types.js'
import {toYaml} from './yaml.js'

export const lineByLineLogger = getLoggerTransformer(log => {
  /**
   * @param args values to log. if `logger.info('a', 1)` is called, `args` will be `['a', 1]`
   * @param depth tracks whether the current call recursive. Used to make sure we don't flatten nested arrays
   */
  const wrapper = (args: unknown[], depth: number) => {
    if (args.length === 1 && Array.isArray(args[0]) && depth === 0) {
      args[0].forEach(item => wrapper([item], 1))
    } else if (args.every(isPrimitive)) {
      log(...args)
    } else if (args.length === 1) {
      log(JSON.stringify(args[0], null, 2))
    } else {
      log(JSON.stringify(args, null, 2))
    }
  }

  return (...args) => wrapper(args, 0)
})

type Primitive = string | number | boolean | bigint | null | undefined
type FlatRecord = Record<string, Primitive>

export const autoTableLogger = getLoggerTransformer(log => (...args) => {
  if (args.length > 1 && args.every(isDisplayPrimitive)) {
    log(...args)
    return
  }

  log(formatLogArgs(args))
})

export const yamlLogger = getLoggerTransformer(log => (...args) => {
  if (args.length > 1 && args.every(isDisplayPrimitive)) {
    log(...args)
    return
  }

  log(formatYamlArgs(args))
})

const isPrimitive = (value: unknown): value is string | number | boolean => {
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean'
}

const isDisplayPrimitive = (value: unknown): value is Primitive =>
  value == null || isPrimitive(value) || typeof value === 'bigint'

const formatLogArgs = (args: unknown[]) => {
  if (args.length !== 1) return safeJsonStringify(args)
  return renderValue(args[0], undefined, new WeakSet<object>())
}

const formatYamlArgs = (args: unknown[]) => {
  if (args.length !== 1) return toYaml(args)
  return toYaml(args[0])
}

const renderValue = (value: unknown, heading: string | undefined, seen: WeakSet<object>): string => {
  if (Array.isArray(value) && value.every(isFlatRecord)) {
    const body = value.length ? renderRowsTable(value) : '[]'
    return withHeading(heading, body)
  }

  if (Array.isArray(value) && value.every(isDisplayPrimitive)) {
    return withHeading(heading, value.map(String).join('\n'))
  }

  if (isFlatRecord(value)) {
    return withHeading(heading, renderKeyValueTable(value))
  }

  if (isDisplayPrimitive(value)) {
    return withHeading(heading, String(value))
  }

  if (isRecord(value)) {
    if (seen.has(value)) return withHeading(heading, '[Circular]')
    seen.add(value)
    const sections = Object.entries(value)
      .map(([key, nested]) => renderValue(nested, key, seen))
      .filter(Boolean)
    if (sections.length) return sections.join('\n\n')
  }

  return withHeading(heading, safeJsonStringify(value))
}

const renderRowsTable = (rows: FlatRecord[]) => {
  const firstRowColumns = rows[0] ? Object.keys(rows[0]) : []
  const extraColumns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
    .filter(column => !firstRowColumns.includes(column))
    .sort()
  const columns = [...firstRowColumns, ...extraColumns]
  const table = new CliTable({head: columns})

  for (const row of rows) {
    table.push(columns.map(column => formatCell(row[column])))
  }

  return table.toString()
}

const renderKeyValueTable = (row: FlatRecord) => {
  const table = new CliTable({head: ['field', 'value']})

  for (const [field, value] of Object.entries(row)) {
    table.push([field, formatCell(value)])
  }

  return table.toString()
}

const formatCell = (value: Primitive) => (value == null ? '' : String(value))

const withHeading = (heading: string | undefined, body: string) => (heading ? `${heading}:\n${body}` : body)

const isFlatRecord = (value: unknown): value is FlatRecord => {
  if (!isRecord(value)) return false
  return Object.values(value).every(isDisplayPrimitive)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const safeJsonStringify = (value: unknown) => {
  const seen = new WeakSet<object>()
  return JSON.stringify(
    value,
    (_key, currentValue: unknown) => {
      if (typeof currentValue === 'bigint') return String(currentValue)
      if (!currentValue || typeof currentValue !== 'object') return currentValue
      const objectValue: object = currentValue
      if (seen.has(objectValue)) return '[Circular]'
      seen.add(objectValue)
      return objectValue
    },
    2,
  )
}

/** Takes a function that wraps an individual log function, and returns a function that wraps the `info` and `error` functions for a logger */
function getLoggerTransformer(transform: (log: Log) => Log) {
  return (logger: Logger): Logger => {
    const info = logger.info && transform(logger.info)
    const error = logger.error && transform(logger.error)
    return {info, error}
  }
}

/**
 * A logger which uses `console.log` and `console.error` to log in the following way:
 * - Primitives are logged directly
 * - Arrays are logged item-by-item
 * - Objects are logged as JSON
 *
 * This is useful for logging structured data in a human-readable way, and for piping logs to other tools.
 */
export const lineByLineConsoleLogger = lineByLineLogger(console)
export const autoTableConsoleLogger = autoTableLogger(console)
export const yamlConsoleLogger = yamlLogger(console)
