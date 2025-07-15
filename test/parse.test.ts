import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v3'
import {TrpcCliMeta} from '../src'
import {run} from './test-run'

const t = initTRPC.meta<TrpcCliMeta>().create()

test('default command', async () => {
  const router = t.router({
    foo: t.procedure
      .meta({default: true})
      .input(z.object({bar: z.number()}))
      .query(({input}) => JSON.stringify(input)),
  })

  const runFoo = await run(router, ['foo', '--bar', '1'])
  expect(runFoo).toEqual({bar: 1})

  const runDefault = await run(router, ['--bar', '1'])
  expect(runDefault).toEqual({bar: 1})
})

test('optional positional', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        z.tuple([
          z.string().optional().describe('name'),
          z.object({
            bar: z.number().optional().describe('bar'),
          }),
        ]),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'abc', '--bar', '1'])).toMatchInlineSnapshot(`"["abc",{"bar":1}]"`)
  expect(await run(router, ['foo', '--bar', '1'])).toMatchInlineSnapshot(`"[null,{"bar":1}]"`)
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"[null,{}]"`)
  expect(await run(router, ['foo', 'def'])).toMatchInlineSnapshot(`"["def",{}]"`)
})

test('required positional', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        z.tuple([
          z.string().describe('name'),
          z.object({
            bar: z.number().optional().describe('bar'),
          }),
        ]),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'abc', '--bar', '1'])).toMatchInlineSnapshot(`"["abc",{"bar":1}]"`)
  expect(await run(router, ['foo', '--bar', '1'])).toMatchInlineSnapshot(
    `"CommanderError: error: missing required argument 'name'"`,
  )
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"CommanderError: error: missing required argument 'name'"`)
  expect(await run(router, ['foo', 'def'])).toMatchInlineSnapshot(`"["def",{}]"`)
})

test('json option', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        z.object({
          obj: z.object({
            abc: z.string(),
            def: z.number(),
          }),
        }),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '--obj', '{"abc":"abc","def":1}'])).toMatchInlineSnapshot(
    `"{"obj":{"abc":"abc","def":1}}"`,
  )
  expect(await run(router, ['foo', '--obj', `{abc: 'abc', def: 1}`])).toMatchInlineSnapshot(
    `"CommanderError: error: option '--obj [json]' argument '{abc: 'abc', def: 1}' is invalid. Malformed JSON."`,
  )
  expect(await run(router, ['foo', '--obj', '{"abc":"abc"}'])).toMatchInlineSnapshot(
    `
      "Error: ✖ Required → at obj.def

      Usage: program foo [options]

      Options:
        --obj [json]  Object (json formatted); Required: ["abc","def"]
        -h, --help    display help for command
      "
    `,
  )
  expect(await run(router, ['foo', '--obj', '{"def":1}'])).toMatchInlineSnapshot(
    `
      "Error: ✖ Required → at obj.abc

      Usage: program foo [options]

      Options:
        --obj [json]  Object (json formatted); Required: ["abc","def"]
        -h, --help    display help for command
      "
    `,
  )
})

test('default value in union subtype', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        z.object({
          foo: z.union([z.boolean().default(true), z.number().default(1)]),
        }),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await run(router, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await run(router, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":1}"`)
})

test('primitive option union', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.object({foo: z.union([z.boolean(), z.number(), z.object({bar: z.string()})])}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await run(router, ['foo', '--foo'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await run(router, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await run(router, ['foo', '--foo', 'false'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await run(router, ['foo', '--no-foo'])).toMatchInlineSnapshot(`
    "CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)"
  `)
  expect(await run(router, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":1}"`)
  expect(await run(router, ['foo', '--foo', '{"bar":"abc"}'])).toMatchInlineSnapshot(`"{"foo":{"bar":"abc"}}"`)
})

test('option union array with enum', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.object({foo: z.union([z.boolean(), z.number(), z.enum(['abc', 'def'])]).array()}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '--foo'])).toMatchInlineSnapshot(`
    "Error: ✖ Expected array, received boolean → at foo

    Usage: program foo [options]

    Options:
      --foo [values...]  Any of:
                         [{"type":"boolean"},{"type":"number"},{"type":"string","enum":["abc","def"]}]
                         array (default: [])
      -h, --help         display help for command
    "
  `)
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"{"foo":[]}"`)
  expect(await run(router, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":[true]}"`)
  expect(await run(router, ['foo', '--foo', 'false'])).toMatchInlineSnapshot(`"{"foo":[false]}"`)
  expect(await run(router, ['foo', '--no-foo'])).toMatchInlineSnapshot(`
    "CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)"
  `)
  expect(await run(router, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":[1]}"`)
  expect(await run(router, ['foo', '--foo', 'abc'])).toMatchInlineSnapshot(`"{"foo":["abc"]}"`)
  expect(await run(router, ['foo', '--foo', 'abc', '--foo', 'true', '--foo', '1'])).toMatchInlineSnapshot(
    `"{"foo":["abc",true,1]}"`,
  )
  expect(await run(router, ['foo', '--foo', 'wrong'])).toMatchInlineSnapshot(`
    "Error: ✖ Invalid input → at foo[0]

    Usage: program foo [options]

    Options:
      --foo [values...]  Any of:
                         [{"type":"boolean"},{"type":"number"},{"type":"string","enum":["abc","def"]}]
                         array (default: [])
      -h, --help         display help for command
    "
  `)
})

test('non-primitive option union', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.object({foo: z.union([z.boolean(), z.number(), z.string(), z.object({bar: z.string()})])}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await run(router, ['foo', '--foo'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await run(router, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await run(router, ['foo', '--foo', 'false'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await run(router, ['foo', '--no-foo'])).toMatchInlineSnapshot(`
    "CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)"
  `)
  expect(await run(router, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":1}"`)
  expect(await run(router, ['foo', '--foo', '{"bar":"abc"}'])).toMatchInlineSnapshot(`"{"foo":{"bar":"abc"}}"`)
  await expect(run(router, ['foo', '--foo', 'abc123'])).resolves.toMatchInlineSnapshot(
    `"CommanderError: error: option '--foo [value]' argument 'abc123' is invalid. Malformed JSON. If passing a string, pass it as a valid JSON string with quotes ("abc123")"`,
  )
})

test('positional array with title', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.array(z.string()).describe('files')) //
      .query(({input}) => JSON.stringify(input)),
    bar: t.procedure
      .input(z.array(z.string().describe('files'))) //
      .query(({input}) => JSON.stringify(input)),
    baz: t.procedure
      .input(z.array(z.string().describe('one single file')).describe('file collection'))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'abc', 'def'])).toMatchInlineSnapshot(`"["abc","def"]"`)
  expect((await run(router, ['foo', '--help'])).split('\n')[0]).toMatchInlineSnapshot(
    `"Usage: program foo [options] <files...>"`,
  )
  expect((await run(router, ['bar', '--help'])).split('\n')[0]).toMatchInlineSnapshot(
    `"Usage: program bar [options] <files...>"`,
  )
  expect((await run(router, ['baz', '--help'])).split('\n')[0]).toMatchInlineSnapshot(
    `"Usage: program baz [options] <file collection...>"`,
  )
})
