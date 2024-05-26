import {Log, Logger} from './types'

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

const isPrimitive = (value: unknown): value is string | number | boolean => {
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean'
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
