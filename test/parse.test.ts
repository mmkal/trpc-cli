import {initTRPC} from '@trpc/server'
import {expect, test} from 'vitest'
import {z} from 'zod/v4'
import {kebabCase, TrpcCliMeta} from '../src/index.js'
import {run, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.meta<TrpcCliMeta>().create()

test('kebab case', () => {
  expect(kebabCase('foo')).toMatchInlineSnapshot(`"foo"`)
  expect(kebabCase('fooBar')).toMatchInlineSnapshot(`"foo-bar"`)
  expect(kebabCase('fooBarBaz')).toMatchInlineSnapshot(`"foo-bar-baz"`)
  expect(kebabCase('foBaBa')).toMatchInlineSnapshot(`"fo-ba-ba"`)
  expect(kebabCase('useMCPServer')).toMatchInlineSnapshot(`"use-mcp-server"`)
  expect(kebabCase('useMCP')).toMatchInlineSnapshot(`"use-mcp"`)
  expect(kebabCase('useMCP1')).toMatchInlineSnapshot(`"use-mcp1"`)
  expect(kebabCase('foo1')).toMatchInlineSnapshot(`"foo1"`)
  expect(kebabCase('HTML')).toMatchInlineSnapshot(`"html"`)
})

test('default command', async () => {
  const router = t.router({
    foo: t.procedure
      .meta({default: true})
      .input(z.object({bar: z.number()}))
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '--bar', '1'])).toMatchInlineSnapshot(`"{"bar":1}"`)

  expect(await run(router, ['--bar', '1'])).toMatchInlineSnapshot(`"{"bar":1}"`)
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
  await expect(run(router, ['foo', '--bar', '1'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CommanderError: error: missing required argument 'name'
    `,
  )
  await expect(run(router, ['foo'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CommanderError: error: missing required argument 'name'
    `,
  )
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
  await expect(run(router, ['foo', '--obj', `{abc: 'abc', def: 1}`])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CommanderError: error: option '--obj [json]' argument '{abc: 'abc', def: 1}' is invalid. Malformed JSON.
    `,
  )
  await expect(run(router, ['foo', '--obj', '{"abc":"abc"}'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CliValidationError: ✖ Invalid input: expected number, received undefined → at obj.def
    `,
  )
  await expect(run(router, ['foo', '--obj', '{"def":1}'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CliValidationError: ✖ Invalid input: expected string, received undefined → at obj.abc
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
  await expect(run(router, ['foo', '--no-foo'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)
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

  await expect(run(router, ['foo', '--foo'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid input: expected array, received boolean → at foo
  `)
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"{"foo":[]}"`)
  expect(await run(router, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":[true]}"`)
  expect(await run(router, ['foo', '--foo', 'false'])).toMatchInlineSnapshot(`"{"foo":[false]}"`)
  await expect(run(router, ['foo', '--no-foo'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)
  `)
  expect(await run(router, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":[1]}"`)
  expect(await run(router, ['foo', '--foo', 'abc'])).toMatchInlineSnapshot(`"{"foo":["abc"]}"`)
  expect(await run(router, ['foo', '--foo', 'abc', '--foo', 'true', '--foo', '1'])).toMatchInlineSnapshot(
    `"{"foo":["abc",true,1]}"`,
  )
  await expect(run(router, ['foo', '--foo', 'wrong'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid input → at foo[0]
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
  await expect(run(router, ['foo', '--no-foo'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)
  `)
  expect(await run(router, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":1}"`)
  expect(await run(router, ['foo', '--foo', '{"bar":"abc"}'])).toMatchInlineSnapshot(`"{"foo":{"bar":"abc"}}"`)
  await expect(run(router, ['foo', '--foo', 'abc123'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CommanderError: error: option '--foo [value]' argument 'abc123' is invalid. Malformed JSON. If passing a string, pass it as a valid JSON string with quotes ("abc123")
    `,
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

test('option with acronym', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        z.object({
          addHTTPHeaders: z.boolean().meta({negatable: true}),
        }),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '--add-http-headers'])).toEqual(`{"addHTTPHeaders":true}`)
  expect(await run(router, ['foo', '--no-add-http-headers'])).toEqual(`{"addHTTPHeaders":false}`)
})

test('allowUnknownOptions with passthrough schema', async () => {
  const router = t.router({
    foo: t.procedure
      .meta({allowUnknownOptions: true})
      .input(z.object({known: z.string().optional()}).passthrough())
      .query(({input}) => JSON.stringify(input)),
  })

  // Known options work as expected
  expect(await run(router, ['foo', '--known', 'value'])).toMatchInlineSnapshot(`"{"known":"value"}"`)

  // Unknown options are passed through
  expect(await run(router, ['foo', '--unknown', 'value'])).toMatchInlineSnapshot(`"{"unknown":"value"}"`)

  // Multiple unknown options
  expect(await run(router, ['foo', '--one', 'a', '--two', 'b'])).toMatchInlineSnapshot(`"{"one":"a","two":"b"}"`)

  // Mix of known and unknown options
  expect(await run(router, ['foo', '--known', 'k', '--unknown', 'u'])).toMatchInlineSnapshot(
    `"{"known":"k","unknown":"u"}"`,
  )

  // Boolean flags
  expect(await run(router, ['foo', '--flag'])).toMatchInlineSnapshot(`"{"flag":true}"`)

  // Negated boolean flags
  expect(await run(router, ['foo', '--no-flag'])).toMatchInlineSnapshot(`"{"flag":false}"`)

  // Equals syntax
  expect(await run(router, ['foo', '--key=value'])).toMatchInlineSnapshot(`"{"key":"value"}"`)

  // Numeric values
  expect(await run(router, ['foo', '--count', '42'])).toMatchInlineSnapshot(`"{"count":42}"`)

  // Boolean string values
  expect(await run(router, ['foo', '--enabled', 'true'])).toMatchInlineSnapshot(`"{"enabled":true}"`)
  expect(await run(router, ['foo', '--disabled', 'false'])).toMatchInlineSnapshot(`"{"disabled":false}"`)

  // Kebab-case to camelCase conversion
  expect(await run(router, ['foo', '--my-option', 'value'])).toMatchInlineSnapshot(`"{"myOption":"value"}"`)
})

test('allowUnknownOptions with record schema', async () => {
  const router = t.router({
    foo: t.procedure
      .meta({allowUnknownOptions: true})
      .input(z.record(z.string(), z.unknown()))
      .query(({input}) => JSON.stringify(input)),
  })

  // Unknown options are passed through
  expect(await run(router, ['foo', '--any-key', 'any-value'])).toMatchInlineSnapshot(`"{"anyKey":"any-value"}"`)

  // Multiple options
  expect(await run(router, ['foo', '--a', '1', '--b', '2', '--c', '3'])).toMatchInlineSnapshot(
    `"{"a":1,"b":2,"c":3}"`,
  )
})

test('allowUnknownOptions requires schema to allow additional properties', async () => {
  const router = t.router({
    foo: t.procedure
      .meta({allowUnknownOptions: true})
      .input(z.object({known: z.string()})) // No .passthrough(), so additionalProperties is false
      .query(({input}) => JSON.stringify(input)),
  })

  // Without passthrough, unknown options should still be rejected even with meta.allowUnknownOptions
  await expect(run(router, ['foo', '--known', 'value', '--unknown', 'value'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: unknown option '--unknown'
    (Did you mean --known?)
  `)
})

test('passthrough schema without allowUnknownOptions falls back to json input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.object({known: z.string().optional()}).passthrough())
      .query(({input}) => JSON.stringify(input)),
  })

  // Without allowUnknownOptions in meta, passthrough schemas fall back to JSON input mode
  // for backward compatibility with existing z.record() behavior
  expect(await run(router, ['foo', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
    "Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Inputs with additional properties
                      are not currently supported)
      -h, --help      display help for command
    "
  `)

  // JSON input works
  expect(await run(router, ['foo', '--input', '{"known":"value","extra":"data"}'])).toMatchInlineSnapshot(
    `"{"known":"value","extra":"data"}"`,
  )
})
