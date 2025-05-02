import {initTRPC} from '@trpc/server'
import {expect, test, vi} from 'vitest'
import {createCli, TrpcCliMeta, z} from '../src'
import {FailedToExitError} from '../src/errors'

const t = initTRPC.meta<TrpcCliMeta>().create()

// these tests just make sure it's possible to override process.exit if you want to capture low-level errors

test('default command', async () => {
  const router = t.router({
    foo: t.procedure
      .meta({default: true})
      .input(z.object({bar: z.number()}))
      .query(({input}) => JSON.stringify(input)),
  })

  const cli = createCli({router})

  const run = async (argv: string[]) => {
    const exit = vi.fn() as any
    const log = vi.fn()
    const result = await cli
      .run({
        argv,
        process: {exit}, // prevent process.exit
        logger: {info: log},
      })
      .catch(err => err)
    if (result.exitCode !== 0) throw result.cause
    return {exit, log, result}
  }

  const runFoo = await run(['foo', '--bar', '1'])

  //   expect(runFoo.exit).toHaveBeenCalledWith(0)
  //   expect(runFoo.log).toHaveBeenCalledWith('{"bar":1}')
  //   expect(runFoo.result).toBeInstanceOf(FailedToExitError)
  //   expect(runFoo.result.exitCode).toBe(0)
  //   expect(runFoo.result.cause).toBe('{"bar":1}')

  const runDefault = await run(['--bar', '1'])
  expect(runDefault.exit).toHaveBeenCalledWith(0)
  expect(runDefault.log).toHaveBeenCalledWith('{"bar":1}')
  expect(runDefault.result).toBeInstanceOf(FailedToExitError)
  expect(runDefault.result.exitCode).toBe(0)
  expect(runDefault.result.cause).toBe('{"bar":1}')
})
