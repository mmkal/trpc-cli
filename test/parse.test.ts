import {initTRPC} from '@trpc/server'
import {expect, test, vi} from 'vitest'
import {z} from 'zod/v3'
import {createCli, TrpcCli, TrpcCliMeta} from '../src'
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

  const runFoo = await run(cli, ['foo', '--bar', '1'])

  expect(runFoo.exit).toHaveBeenCalledWith(0)
  expect(runFoo.log).toHaveBeenCalledWith('{"bar":1}')
  expect(runFoo.result).toBeInstanceOf(FailedToExitError)
  expect(runFoo.result.exitCode).toBe(0)
  expect(runFoo.result.cause).toBe('{"bar":1}')

  const runDefault = await run(cli, ['--bar', '1'])

  expect(runDefault.exit).toHaveBeenCalledWith(0)
  expect(runDefault.log).toHaveBeenCalledWith('{"bar":1}')
  expect(runDefault.result).toBeInstanceOf(FailedToExitError)
  expect(runDefault.result.exitCode).toBe(0)
  expect(runDefault.result.cause).toBe('{"bar":1}')
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

  const cli = createCli({router})

  expect(await output(cli, ['foo', 'abc', '--bar', '1'])).toMatchInlineSnapshot(`"["abc",{"bar":1}]"`)
  expect(await output(cli, ['foo', '--bar', '1'])).toMatchInlineSnapshot(`"[null,{"bar":1}]"`)
  expect(await output(cli, ['foo'])).toMatchInlineSnapshot(`"[null,{}]"`)
  expect(await output(cli, ['foo', 'def'])).toMatchInlineSnapshot(`"["def",{}]"`)
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

  const cli = createCli({router})

  expect(await output(cli, ['foo', 'abc', '--bar', '1'])).toMatchInlineSnapshot(`"["abc",{"bar":1}]"`)
  expect(await output(cli, ['foo', '--bar', '1'])).toMatchInlineSnapshot(
    `"CommanderError: error: missing required argument 'name'"`,
  )
  expect(await output(cli, ['foo'])).toMatchInlineSnapshot(`"CommanderError: error: missing required argument 'name'"`)
  expect(await output(cli, ['foo', 'def'])).toMatchInlineSnapshot(`"["def",{}]"`)
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

  const cli = createCli({router})

  expect(await output(cli, ['foo', '--obj', '{"abc":"abc","def":1}'])).toMatchInlineSnapshot(
    `"{"obj":{"abc":"abc","def":1}}"`,
  )
  expect(await output(cli, ['foo', '--obj', `{abc: 'abc', def: 1}`])).toMatchInlineSnapshot(
    `"CommanderError: error: option '--obj [json]' argument '{abc: 'abc', def: 1}' is invalid. Malformed JSON."`,
  )
  expect(await output(cli, ['foo', '--obj', '{"abc":"abc"}'])).toMatchInlineSnapshot(
    `
      "Error: ✖ Required → at obj.def

      Usage: program foo [options]

      Options:
        --obj [json]  Object (json formatted); Required: ["abc","def"]
        -h, --help    display help for command
      "
    `,
  )
  expect(await output(cli, ['foo', '--obj', '{"def":1}'])).toMatchInlineSnapshot(
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

  const cli = createCli({router})

  expect(await output(cli, ['foo'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await output(cli, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await output(cli, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":1}"`)
})

test('primitive option union', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.object({foo: z.union([z.boolean(), z.number(), z.object({bar: z.string()})])}))
      .query(({input}) => JSON.stringify(input)),
  })

  const cli = createCli({router})

  expect(await output(cli, ['foo'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await output(cli, ['foo', '--foo'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await output(cli, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await output(cli, ['foo', '--foo', 'false'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await output(cli, ['foo', '--no-foo'])).toMatchInlineSnapshot(`
    "CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)"
  `)
  expect(await output(cli, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":1}"`)
  expect(await output(cli, ['foo', '--foo', '{"bar":"abc"}'])).toMatchInlineSnapshot(`"{"foo":{"bar":"abc"}}"`)
})

test('option union array with enum', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.object({foo: z.union([z.boolean(), z.number(), z.enum(['abc', 'def'])]).array()}))
      .query(({input}) => JSON.stringify(input)),
  })

  const cli = createCli({router})

  expect(await output(cli, ['foo', '--foo'])).toMatchInlineSnapshot(`
    "Error: ✖ Expected array, received boolean → at foo

    Usage: program foo [options]

    Options:
      --foo [values...]  Any of:
                         [{"type":"boolean"},{"type":"number"},{"type":"string","enum":["abc","def"]}]
                         array (default: [])
      -h, --help         display help for command
    "
  `)
  expect(await output(cli, ['foo'])).toMatchInlineSnapshot(`"{"foo":[]}"`)
  expect(await output(cli, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":[true]}"`)
  expect(await output(cli, ['foo', '--foo', 'false'])).toMatchInlineSnapshot(`"{"foo":[false]}"`)
  expect(await output(cli, ['foo', '--no-foo'])).toMatchInlineSnapshot(`
    "CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)"
  `)
  expect(await output(cli, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":[1]}"`)
  expect(await output(cli, ['foo', '--foo', 'abc'])).toMatchInlineSnapshot(`"{"foo":["abc"]}"`)
  expect(await output(cli, ['foo', '--foo', 'abc', '--foo', 'true', '--foo', '1'])).toMatchInlineSnapshot(
    `"{"foo":["abc",true,1]}"`,
  )
  expect(await output(cli, ['foo', '--foo', 'wrong'])).toMatchInlineSnapshot(`
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

  const cli = createCli({router})

  expect(await output(cli, ['foo'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await output(cli, ['foo', '--foo'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await output(cli, ['foo', '--foo', 'true'])).toMatchInlineSnapshot(`"{"foo":true}"`)
  expect(await output(cli, ['foo', '--foo', 'false'])).toMatchInlineSnapshot(`"{"foo":false}"`)
  expect(await output(cli, ['foo', '--no-foo'])).toMatchInlineSnapshot(`
    "CommanderError: error: unknown option '--no-foo'
    (Did you mean --foo?)"
  `)
  expect(await output(cli, ['foo', '--foo', '1'])).toMatchInlineSnapshot(`"{"foo":1}"`)
  expect(await output(cli, ['foo', '--foo', '{"bar":"abc"}'])).toMatchInlineSnapshot(`"{"foo":{"bar":"abc"}}"`)
  await expect(output(cli, ['foo', '--foo', 'abc123'])).resolves.toMatchInlineSnapshot(
    `"CommanderError: error: option '--foo [value]' argument 'abc123' is invalid. Malformed JSON. If passing a string, pass it as a valid JSON string with quotes ("abc123")"`,
  )
})

const run = async (cli: TrpcCli, argv: string[]) => {
  const exit = vi.fn() as any
  const log = vi.fn()
  const result = await cli
    .run({
      argv,
      process: {exit}, // prevent process.exit
      logger: {info: log, error: log},
    })
    .catch(err => err)
  if (result.exitCode !== 0) throw result.cause
  return {exit, log, result}
}
const output = async (cli: TrpcCli, argv: string[]) => {
  try {
    const {log} = await run(cli, argv)
    return log.mock.calls.map(call => call[0]).join('\n')
  } catch (err) {
    return String(err)
  }
}
