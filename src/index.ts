import {z} from 'zod'
import * as trpc from '@trpc/server'

export interface CliAdapterParams {
  router: trpc.AnyRouter
}
export interface ProcessLike {
  argv: string[]
  exit: <T, U>(code: number, result?: T) => U
  stdout: {
    write: (msg: string) => void
  }
  stderr: {
    write: (msg: string) => void
  }
}
const defaultCliConfig = {
  argv: process.argv,
  succeed: (value: unknown): any => {
    console.log(`Success:`, {value})
    process.exit(0)
  },
  fail: (error: unknown): any => {
    console.log('Failure:', {error})
    process.exit(1)
  }
}
export const cliAdapter = ({router}) => {
  const run = ([path, ...argv]: string[]) => {
    const type = path in router._def.queries ? 'query' : 'mutation'
    const def: undefined | {inputParser: unknown} = router._def[type === 'query' ? 'queries' : 'mutations'][path]
    if (!def) {
      const defs = {...router._def.queries, ...router._def.mutations}
      throw new Error(`Procedure ${path} not found. (Paths detected: ${Object.keys(defs).join(', ')})`)
    }
    const inputParser = def.inputParser || z.object({})
    if (!(inputParser instanceof z.ZodObject)) {
      throw new Error(`Only zod object input parsers are supported currently`)
    }
    const val = Object.fromEntries(
      Object.entries(inputParser.shape)
        .map(([k, v]) => {
          return [k, coerce(v as z.ZodType, parseValues(argv, `--${k}`))]
        })
        .filter(e => typeof e[1] !== 'undefined'),
    )
    return trpc.callProcedure({
      ctx: {},
      router: router,
      input: val,
      path,
      type,
    })
  }
  const cli = async (config?: Partial<typeof defaultCliConfig>) => {
    const resolvedConfig = {...defaultCliConfig, ...config}
    try {
      const result = await run(resolvedConfig.argv.slice(2))
      return resolvedConfig.succeed(result)
    } catch (error) {
      return resolvedConfig.fail(error)
    }
  }
  return {run, cli}
}

const parseValues = (argv: string[], argName: string) => {
  const positions = argv
    .flatMap(a => a.split('=')) // e.g. --foo=bar -> --foo bar
    .flatMap((a, i) => (a === argName ? [i] : []))
  return positions.map(i => argv[i + 1])
}

const coerce = (type: z.ZodType, values: string[]) => {
  if (type instanceof z.ZodEffects) {
    return coerce(type._def.schema, values)
  }
  if (type instanceof z.ZodArray) {
    return values.map(v => coerce(type._def.type, [v]))
  }
  if (values.length > 1) {
    throw new Error(`Expected no more than 1 value, got ${values.length}`)
  }

  const [val] = values[0]
  if (type instanceof z.ZodObject) {
    return coerce(type, JSON.parse(val))
  }
  if (type instanceof z.ZodBoolean) {
    return values.length > 0 && !['0', 'false', 'f'].includes(val.toLowerCase())
  }
  if (values.length === 0) {
    return undefined
  }
  if (type instanceof z.ZodNumber) {
    const num = Number(values[0])
    return Number.isNaN(num) ? val : num
  }
  return values[0]
}
