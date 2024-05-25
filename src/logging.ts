import {LogMethod, Logger} from './types'

export const primitiveOrJsonLogger = getLoggerTransformer(method => {
  const transformed: LogMethod = (...args) => {
    if (args.length === 1 && Array.isArray(args[0])) {
      args[0].forEach(item => transformed(item))
    } else if (args.every(isPrimitive)) {
      method(...args)
    } else if (args.length === 1) {
      method(JSON.stringify(args[0], null, 2))
    } else {
      method(JSON.stringify(args, null, 2))
    }
  }

  return transformed
})

const isPrimitive = (value: unknown): value is string | number | boolean => {
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean'
}

type TransformLogMethod = (method: LogMethod) => LogMethod

function getLoggerTransformer(transform: TransformLogMethod) {
  return (logger: Logger): Logger => {
    const info = logger.info && transform(logger.info)
    const error = logger.error && transform(logger.error)
    return {info, error}
  }
}

export const primitiveOrJsonConsoleLogger = primitiveOrJsonLogger(console)
