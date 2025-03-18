import {initTRPC} from '@trpc/server'
import {expect, test, vi} from 'vitest'
import {createCli, TrpcCliMeta, z} from '../src'
import {FailedToExitError} from '../src/errors'

const t = initTRPC.meta<TrpcCliMeta>().create()

// these tests just make sure it's possible to override process.exit if you want to capture low-level errors

test('override of process.exit happy path', async () => {
  const router = t.router({
    foo: t.procedure.input(z.object({bar: z.number()})).query(({input}) => JSON.stringify(input)),
  })

  const cli = createCli({router})

  const exit = vi.fn() as any
  const log = vi.fn()
  const result = await cli
    .run({
      argv: ['foo', '--bar', '1'],
      process: {exit}, // prevent process.exit
      logger: {info: log},
    })
    .catch(err => err)

  expect(exit).toHaveBeenCalledWith(0)
  expect(log).toHaveBeenCalledWith('{"bar":1}')
  expect(result).toBeInstanceOf(FailedToExitError)
  expect(result.exitCode).toBe(0)
  expect(result.cause).toBe('{"bar":1}')
})

test('override of process.exit and pass in bad option', async () => {
  const router = t.router({
    foo: t.procedure.input(z.object({bar: z.number()})).query(({input}) => Object.entries(input).join(', ')),
  })

  const cli = createCli({router})

  const result = await cli
    .run({
      argv: ['foo', '--bar', 'notanumber'],
      process: {exit: () => void 0 as never}, // prevent process.exit
      logger: {error: () => void 0},
    })
    .catch(err => err)

  expect(result).toMatchInlineSnapshot(
    `[Error: Program exit after failure. The process was expected to exit with exit code 1 but did not. This may be because a custom \`process\` parameter was used. The exit reason is in the \`cause\` property.]`,
  )
  expect(result.exitCode).toBe(1)
  expect(result.cause).toMatchInlineSnapshot(`
    [Error: Validation error
      - Expected number, received string at "--bar"

    Usage: program foo [options]

    Options:
      --bar <number>
      -h, --help      display help for command
    ]
  `)
  expect(result.cause.cause).toMatchInlineSnapshot(`undefined`)
})

test('override of process.exit with parse error', async () => {
  const router = t.router({
    foo: t.procedure.input(z.object({bar: z.number()})).query(({input}) => Object.entries(input).join(', ')),
  })

  const cli = createCli({router})

  const result = await cli
    .run({
      argv: ['footypo', '--bar', 'notanumber'],
      process: {exit: () => void 0 as never}, // prevent process.exit
      logger: {error: () => void 0},
    })
    .catch(err => err)

  expect(result).toMatchInlineSnapshot(
    `[Error: Root command exitOverride. The process was expected to exit with exit code 1 but did not. This may be because a custom \`process\` parameter was used. The exit reason is in the \`cause\` property.]`,
  )
  expect(result.cause).toMatchInlineSnapshot(
    `[CommanderError: error: unknown command 'footypo']`,
  )
  expect(result.cause.cause).toMatchInlineSnapshot(`undefined`)
})

const calculatorRouter = t.router({
  add: t.procedure.input(z.tuple([z.number(), z.number()])).query(({input}) => {
    return input[0] + input[1]
  }),
  squareRoot: t.procedure.input(z.number()).query(({input}) => {
    if (input < 0) throw new Error(`Get real`)
    return Math.sqrt(input)
  }),
})

const run = async (argv: string[]) => {
  const cli = createCli({router: calculatorRouter})
  return cli
    .run({
      argv,
      process: {exit: () => void 0 as never},
      logger: {info: () => {}, error: () => {}},
    })
    .catch(err => {
      // this will always throw, because our `exit` handler doesn't throw or exit the process
      while (err instanceof FailedToExitError) {
        if (err.exitCode === 0) {
          return err.cause // this is the return value of the procedure that was invoked
        }
        err = err.cause // use the underlying error that caused the exit
      }
      throw err
    })
}

test('make sure parsing works correctly', async () => {
  await expect(run(['add', '2', '3'])).resolves.toBe(5)
  await expect(run(['squareRoot', '--', '4'])).resolves.toBe(2)
  await expect(run(['squareRoot', '--', '-1'])).rejects.toMatchInlineSnapshot(`[Error: Get real]`)
  await expect(run(['add', '2', 'notanumber'])).rejects.toMatchInlineSnapshot(`
    [Error: Validation error
      - Expected number, received string at index 1

    Usage: program add [options] <parameter_1> <parameter_2>

    Arguments:
      parameter_1   (required)
      parameter_2   (required)

    Options:
      -h, --help   display help for command
    ]
  `)
})
