import {os, resolveContractProcedures, call} from '@orpc/server'
import * as v from 'valibot'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {inferRouterContext, OrpcProcedureLike, OrpcRouterLike} from '../src/trpc-compat'
import {run, snapshotSerializer} from './test-run'

expect.addSnapshotSerializer({
  test: val => val instanceof z.ZodType,
  print: val => (val as object)?.constructor.name,
})

expect.addSnapshotSerializer(snapshotSerializer)

const o = os.$context<{x: number}>()
const router = o.router({
  hello: o
    .input(
      z.object({
        foo: z.string(),
        bar: z.number(),
      }),
    )
    .handler(({input}) => `hello ${input.foo} ${input.bar}`),
  withValibot: o
    .input(
      v.object({
        abc: v.string(),
        def: v.number(),
      }),
    )
    .handler(({input}) => `abc is ${input.abc} and def is ${input.def}`),
  deeply: {
    nested: {
      greeting: o.input(z.string()).handler(({input}) => `hello ${input}`),
    },
  },
})

test('orpc-cli', async () => {
  expect(await run(router, ['hello', '--foo', 'world', '--bar', '42'])).toMatchInlineSnapshot(`"hello world 42"`)
  expect(await run(router, ['with-valibot', '--abc', 'hello', '--def', '42'])).toMatchInlineSnapshot(
    `"abc is hello and def is 42"`,
  )
  expect(await run(router, ['deeply', 'nested', 'greeting', 'hi'])).toMatchInlineSnapshot(`"hello hi"`)
})

// just for me to look at what orpc routers/procedures/resolveContractProcedures look like

test('orpc server testing', async () => {
  router.hello['~orpc'].__initialContext?.({x: 1})
  router.hello satisfies OrpcProcedureLike<{x: number}>
  router.deeply.nested.greeting satisfies OrpcProcedureLike<{x: number}>
  router satisfies OrpcRouterLike<{x: number}>

  const _ctx = {x: 1} as inferRouterContext<typeof router> satisfies {x: number}

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
      "withValibot": Procedure {
        "~orpc": {
          "config": {},
          "dedupeLeadingMiddlewares": true,
          "errorMap": {},
          "handler": [Function],
          "inputSchema": {
            "async": false,
            "entries": {
              "abc": {
                "async": false,
                "expects": "string",
                "kind": "schema",
                "message": undefined,
                "reference": [Function],
                "type": "string",
                "~run": [Function],
                "~standard": {
                  "validate": [Function],
                  "vendor": "valibot",
                  "version": 1,
                },
              },
              "def": {
                "async": false,
                "expects": "number",
                "kind": "schema",
                "message": undefined,
                "reference": [Function],
                "type": "number",
                "~run": [Function],
                "~standard": {
                  "validate": [Function],
                  "vendor": "valibot",
                  "version": 1,
                },
              },
            },
            "expects": "Object",
            "kind": "schema",
            "message": undefined,
            "reference": [Function],
            "type": "object",
            "~run": [Function],
            "~standard": {
              "validate": [Function],
              "vendor": "valibot",
              "version": 1,
            },
          },
          "inputValidationIndex": 0,
          "meta": {},
          "middlewares": [],
          "outputValidationIndex": 0,
          "route": {},
        },
      },
    }
  `)

  const contracts = [] as any[]
  resolveContractProcedures({path: [], router}, ({contract, path}) => {
    contracts.push({contract, path})
  })
  expect(contracts).toMatchInlineSnapshot(`
    [
      {
        "contract": Procedure {
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
        "path": [
          "hello",
        ],
      },
      {
        "contract": Procedure {
          "~orpc": {
            "config": {},
            "dedupeLeadingMiddlewares": true,
            "errorMap": {},
            "handler": [Function],
            "inputSchema": {
              "async": false,
              "entries": {
                "abc": {
                  "async": false,
                  "expects": "string",
                  "kind": "schema",
                  "message": undefined,
                  "reference": [Function],
                  "type": "string",
                  "~run": [Function],
                  "~standard": {
                    "validate": [Function],
                    "vendor": "valibot",
                    "version": 1,
                  },
                },
                "def": {
                  "async": false,
                  "expects": "number",
                  "kind": "schema",
                  "message": undefined,
                  "reference": [Function],
                  "type": "number",
                  "~run": [Function],
                  "~standard": {
                    "validate": [Function],
                    "vendor": "valibot",
                    "version": 1,
                  },
                },
              },
              "expects": "Object",
              "kind": "schema",
              "message": undefined,
              "reference": [Function],
              "type": "object",
              "~run": [Function],
              "~standard": {
                "validate": [Function],
                "vendor": "valibot",
                "version": 1,
              },
            },
            "inputValidationIndex": 0,
            "meta": {},
            "middlewares": [],
            "outputValidationIndex": 0,
            "route": {},
          },
        },
        "path": [
          "withValibot",
        ],
      },
      {
        "contract": Procedure {
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
        "path": [
          "deeply",
          "nested",
          "greeting",
        ],
      },
    ]
  `)

  const result = await call(router.hello, {foo: 'world', bar: 42}, {context: {x: 1}})
  expect(result).toMatchInlineSnapshot(`"hello world 42"`)
})
