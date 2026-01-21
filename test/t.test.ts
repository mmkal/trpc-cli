/* eslint-disable @typescript-eslint/no-shadow */
import * as v from 'valibot'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {t} from '../src/index.js'
import {run, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer({
  test: val => val instanceof z.ZodType,
  print: val => (val as object)?.constructor.name,
})

expect.addSnapshotSerializer(snapshotSerializer)

expect.addSnapshotSerializer({
  test: val => typeof val === 'string',
  serialize: val =>
    `"${val}"`.replaceAll('json-schema.org/draft-2020-12/schema', 'json-schema.org/draft/2020-12/schema'),
})

const router = t.router({
  hello: t.procedure
    .input(
      z.object({
        foo: z.string(),
        bar: z.number(),
      }),
    )
    .handler(({input}) => `hello ${input.foo} ${input.bar}`),
  withValibot: t.procedure
    .input(
      v.object({
        abc: v.string(),
        def: v.number(),
      }),
    )
    .handler(({input}) => `abc is ${input.abc} and def is ${input.def}`),
  deeply: {
    nested: {
      greeting: t.procedure.input(z.string()).handler(({input}) => `hello ${input}`),
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

test('orpc unjsonifiable schema', async () => {
  const router = t.router({
    hello: t.procedure
      .input(
        z.custom<{foo: string; bar: number}>(v => {
          const value = v as Record<string, unknown>
          return typeof value?.foo === 'string' && typeof value.bar === 'number'
        }),
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
  const router = t.router({
    hello: t.procedure
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
