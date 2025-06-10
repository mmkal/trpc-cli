import {os} from '@orpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'

expect.addSnapshotSerializer({
  test: val => val instanceof z.ZodType,
  print: val => (val as object)?.constructor.name,
})

const router = os.router({
  hello: os
    .input(
      z.object({
        foo: z.string(),
        bar: z.number(),
      }),
    )
    .handler(({input}) => `hello ${input.foo} ${input.bar}`),
  deeply: {
    nested: {
      greeting: os.input(z.string()).handler(({input}) => `hello ${input}`),
    },
  },
})

test('orpc router', async () => {
  console.log(router)

  expect(router).toMatchInlineSnapshot(`
    {
      "deeply": {
        "nested": {
          "greeting": Procedure {
            "~orpc": {
              "config": {},
              "dedupeLeadingMiddlewares": true,
              "errorMap": {},
              "handler": [Function],
              "inputSchema": ZodString,
              "inputValidationIndex": 0,
              "meta": {},
              "middlewares": [],
              "outputValidationIndex": 0,
              "route": {},
            },
          },
        },
      },
      "hello": Procedure {
        "~orpc": {
          "config": {},
          "dedupeLeadingMiddlewares": true,
          "errorMap": {},
          "handler": [Function],
          "inputSchema": ZodObject,
          "inputValidationIndex": 0,
          "meta": {},
          "middlewares": [],
          "outputValidationIndex": 0,
          "route": {},
        },
      },
    }
  `)
})
