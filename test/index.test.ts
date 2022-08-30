import {cliAdapter} from '../src'
import * as trpc from '@trpc/server'
import {z} from 'zod'

expect.addSnapshotSerializer({
  test: val => jest.isMockFunction(val),
  print: val =>
    JSON.stringify((val as jest.Mock).mock.calls, null, 2)
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

  const succeed = jest.fn()
  await cli({
    argv: ['node', 'script.js', 'sum', '--left', '1', '--right', '2'],
    succeed,
  })
  expect(succeed.mock.calls).toMatchObject([[3]])
})

test('cli failure', async () => {
  const {cli} = cliAdapter({router: sumRouter})

  const succeed = jest.fn()
  const fail = jest.fn()
  await cli({
    argv: ['node', 'script.js', 'sum', '--left', '1', '--right', 'notanumber'],
    succeed,
    fail,
  })
  expect({succeed, fail}).toMatchInlineSnapshot(`
    Object {
      "fail": [
      [
        {
          "originalError": {
            "issues": [
              {
                "code": "invalid_type",
                "expected": "number",
                "received": "string",
                "path": [
                  "right"
                ],
                "message": "Expected number, received string"
              }
            ],
            "name": "ZodError"
          },
          "code": "BAD_REQUEST",
          "name": "TRPCError"
        }
      ]
    ],
      "succeed": [],
    }
  `)
})
