/* eslint-disable @typescript-eslint/no-shadow */
import {oc} from '@orpc/contract'
import {implement, os, unlazyRouter} from '@orpc/server'
import * as v from 'valibot'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
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

test('lazy router', async () => {
  const lazyRouter = os.router({
    greeting: {
      casual: os.input(z.string()).handler(({input}) => `hi ${input}`),
      formal: os.input(z.string()).handler(({input}) => `hello ${input}`),
    },
    departure: os.lazy(async () => ({
      // default needed because os.lazy is designed for `os.lazy(() => import('./somemodule'))`
      default: {
        casual: os.input(z.string()).handler(({input}) => `bye ${input}`),
        formal: os.input(z.string()).handler(({input}) => `goodbye ${input}`),
      },
    })),
  })

  // @ts-expect-error - we want an error here - that means users will get a type error if they try to use a lazy router without unlazying it first
  await expect(run(lazyRouter, ['greeting', 'casual', 'bob'])).rejects.toMatchInlineSnapshot(
    `Error: Lazy routers are not supported. Please use \`import {unlazyRouter} from '@orpc/server'\` to unlazy the router before passing it to trpc-cli. Lazy routes detected: departure`,
  )

  const {departure, ...eagerRouterSubset} = lazyRouter
  expect(await run(eagerRouterSubset, ['greeting', 'casual', 'bob'])).toMatchInlineSnapshot(`"hi bob"`)

  const unlazy = await unlazyRouter(lazyRouter)
  await expect(run(unlazy, ['departure', 'casual', 'bob'])).resolves.toMatchInlineSnapshot(`"bye bob"`)
})

test('contract-based router', async () => {
  const contract = oc.router({
    hello: oc.input(z.string()).output(z.string()),
    deeply: {
      nested: {
        greeting: oc.input(z.string()).output(z.string()),
      },
    },
  })

  const os = implement(contract)

  const router = os.router({
    hello: os.hello.handler(({input}) => `hello ${input}`),
    deeply: {
      nested: {
        greeting: os.deeply.nested.greeting.handler(({input}) => `hi ${input}`),
      },
    },
  })

  expect(await run(router, ['hello', 'world'])).toMatchInlineSnapshot(`"hello world"`)
  expect(await run(router, ['deeply', 'nested', 'greeting', 'bob'])).toMatchInlineSnapshot(`"hi bob"`)
})

test('orpc unjsonifiable schema', async () => {
  const router = o.router({
    hello: o
      .input(
        z.custom<{foo: string; bar: number}>(value => typeof value?.foo === 'string' && typeof value?.bar === 'number'),
      )
      .handler(({input}) => `foo is ${input.foo} and bar is ${input.bar}`),
  })

  expect(await run(router, ['hello', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
    "Usage: program hello [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Invalid input type { '$schema':
                      'https://json-schema.org/draft/2020-12/schema' }, expected
                      object or tuple.)
      -h, --help      display help for command
    "
  `)
  expect(await run(router, ['hello', '--input', '{"foo": "world", "bar": 42}'])).toMatchInlineSnapshot(
    `"foo is world and bar is 42"`,
  )
})

test('orpc json input via meta', async () => {
  const router = o.router({
    hello: o
      .meta({jsonInput: true})
      .input(z.object({foo: z.string(), bar: z.number()}))
      .handler(({input}) => `foo is ${input.foo} and bar is ${input.bar}`),
  })

  expect(await run(router, ['hello', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
    "Usage: program hello [options]

    Options:
      --input [json]  Input formatted as JSON
      -h, --help      display help for command
    "
  `)
  expect(await run(router, ['hello', '--input', '{"foo": "world", "bar": 42}'])).toMatchInlineSnapshot(
    `"foo is world and bar is 42"`,
  )
})
