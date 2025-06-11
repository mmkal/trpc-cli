import {os} from '@orpc/server'
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
