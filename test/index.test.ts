import {cliAdapter} from '../src'
import * as trpc from '@trpc/server'
import {z} from 'zod'

expect.addSnapshotSerializer({
  test: val => jest.isMockFunction(val),
  print: val =>
    JSON.stringify((val as jest.Mock).mock.calls)
      .split(process.cwd())
      .join('[cwd]'),
})

const sumRouter = trpc
  .router()
  .mutation('sum', {
    input: z.object({
      left: z.number(),
      right: z.number(),
    }),
    resolve: ({input}) => input.left + input.right,
  })
  .query('divide', {
    input: z.object({left: z.number(), right: z.number().refine(n => n !== 0)}),
    resolve: ({input}) => input.left / input.right,
  })

test('run', async () => {
  const {run} = cliAdapter({router: sumRouter})

  expect(await run(['sum', '--left', '1.4', '--right', '4'])).toEqual(5.4)
  expect(await run(['divide', '--left', '8', '--right', '4'])).toEqual(2)
})

test('cli success', async () => {
  const {cli} = cliAdapter({router: sumRouter})

  const log = jest.fn()
  const logErr = jest.fn()
  const exit = jest.fn()
  await cli({
    argv: ['node', 'script.js', 'sum', '--left', '1', '--right', '2'],
    exit,
    stdout: {write: log},
    stderr: {write: logErr},
  })
  expect({log, logErr, exit}).toMatchInlineSnapshot(`
    Object {
      "exit": [[0,3]],
      "log": [["Success. Result: 3"]],
      "logErr": [],
    }
  `)
})

test('cli failure', async () => {
  const {cli} = cliAdapter({router: sumRouter})

  const log = jest.fn()
  const logErr = jest.fn()
  const exit = jest.fn()
  await cli({
    argv: ['node', 'script.js', 'sum', '--left', '1', '--right', 'notanumber'],
    exit,
    stdout: {write: log},
    stderr: {write: logErr},
  })
  expect({log, logErr, exit}).toMatchInlineSnapshot(`
    Object {
      "exit": [[1,{"originalError":{"issues":[{"code":"invalid_type","expected":"number","received":"string","path":["right"],"message":"Expected number, received string"}],"name":"ZodError"},"code":"BAD_REQUEST","name":"TRPCError"}]],
      "log": [],
      "logErr": [["Failure. Error: TRPCError: [\\n  {\\n    \\"code\\": \\"invalid_type\\",\\n    \\"expected\\": \\"number\\",\\n    \\"received\\": \\"string\\",\\n    \\"path\\": [\\n      \\"right\\"\\n    ],\\n    \\"message\\": \\"Expected number, received string\\"\\n  }\\n]\\n    at Procedure.parseInput ([cwd]/node_modules/@trpc/server/dist/router-bf2f9f44.cjs.dev.js:71:13)\\n    at processTicksAndRejections (node:internal/process/task_queues:96:5)\\n    at Array.<anonymous> ([cwd]/node_modules/@trpc/server/dist/router-bf2f9f44.cjs.dev.js:100:21)\\n    at callRecursive ([cwd]/node_modules/@trpc/server/dist/router-bf2f9f44.cjs.dev.js:119:24)\\n    at Procedure.call ([cwd]/node_modules/@trpc/server/dist/router-bf2f9f44.cjs.dev.js:144:20)"]],
    }
  `)
})
