import * as trpcServer from '@trpc/server'
import {expect, test, vi} from 'vitest'
import {z} from 'zod'
import {trpcCli} from '../src'

const trpc = trpcServer.initTRPC.create()

const sumRouter = trpc.router({
  sum: trpc.procedure
    .input(
      z.object({
        left: z.number(),
        right: z.number(),
      }),
    )
    .mutation(({input}) => input.left + input.right),
  divide: trpc.procedure
    .input(
      z.object({
        left: z.number(),
        right: z.number().refine(n => n !== 0),
      }),
    )
    .query(({input}) => input.left / input.right),
})

expect.addSnapshotSerializer({
  test: val => vi.isMockFunction(val),
  print: val => JSON.stringify((val as any).mock.calls, null, 2).replaceAll(process.cwd(), '[cwd]'),
})

test.skip('help', async () => {
  const {run} = trpcCli({router: sumRouter})

  Object.assign(process, {exit: vi.fn()})

  await run({argv: ['--help']})
  await run({argv: ['divide', '--help']})
})

test('run', async () => {
  const {run} = trpcCli({router: sumRouter})

  expect(await run({argv: ['sum', '--left', '1.4', '--right', '4']})).toEqual(5.4)
  expect(await run({argv: ['divide', '--left', '8', '--right', '4']})).toEqual(2)
})

test('cli success', async () => {
  const {run} = trpcCli({router: sumRouter})

  const result = await run({argv: ['sum', '--left', '1', '--right', '2']})
  expect(result).toMatchObject(3)
})

test('cli failure', async () => {
  const {run} = trpcCli({router: sumRouter})

  const fail = vi.fn()
  await run({
    argv: ['sum', '--left', '1', '--right', 'notanumber'],
    console: {error: fail},
    process: {exit: vi.fn()},
  })
  expect(fail.mock.calls[0][0]).toMatchInlineSnapshot(`
    "[31mValidation error
      - Expected number, received nan at "--right"[39m"
  `)
})
