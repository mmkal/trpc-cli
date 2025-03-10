import {initTRPC} from '@trpc/server'
import {expect, test, vi} from 'vitest'
import {createCli, TrpcCliMeta, z} from '../src'

const t = initTRPC.meta<TrpcCliMeta>().create()

// these tests just make sure it's possible to override process.exit if you want to capture low-level errors

test('override of process.exit happy path', async () => {
  const router = t.router({
    foo: t.procedure.input(z.object({bar: z.number()})).query(({input}) => Object.entries(input).join(', ')),
  })

  const cli = createCli({router})

  const exit = vi.fn() as any
  const log = vi.fn()
  await cli
    .run({
      argv: ['foo', '--bar', '1'],
      process: {exit}, // prevent process.exit
      logger: {info: log},
    })
    .catch(err => err)

  expect(exit).toHaveBeenCalledWith(0)
  expect(log).toHaveBeenCalledWith('bar,1')
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
    `[Error: Program parse catch block. An error was thrown but the process did not exit. This may be because a custom \`process\` parameter was used. The Previous error is in the \`cause\`.]`,
  )
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
    `[Error: Program parse catch block. An error was thrown but the process did not exit. This may be because a custom \`process\` parameter was used. The Previous error is in the \`cause\`.]`,
  )
  expect(result.cause).toMatchInlineSnapshot(
    `[Error: Root command exitOverride. An error was thrown but the process did not exit. This may be because a custom \`process\` parameter was used. The Previous error is in the \`cause\`.]`,
  )
  expect(result.cause.cause).toMatchInlineSnapshot(`[CommanderError: error: unknown command 'footypo']`)
})
