import {initTRPC} from '@trpc/server'
import {expect, test, vi} from 'vitest'
import {createCli, TrpcCli, TrpcCliMeta, z} from '../src'
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
      "Error: ✖ Invalid input: expected number, received undefined → at obj.def

      Usage: program foo [options]

      Options:
        --obj [json]  Object (json formatted); Required: ["abc","def"]
        -h, --help    display help for command
      "
    `,
  )
  expect(await output(cli, ['foo', '--obj', '{"def":1}'])).toMatchInlineSnapshot(
    `
      "Error: ✖ Invalid input: expected string, received undefined → at obj.abc

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
    "Error: ✖ Invalid input: expected array, received boolean → at foo

    Usage: program foo [options]

    Options:
      --foo [values...]  Any of:
                         [{"type":"boolean"},{"type":"number"},{"enum":["abc","def"]}]
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
                         [{"type":"boolean"},{"type":"number"},{"enum":["abc","def"]}]
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

  const cli = createCli({router})
  expect(await output(cli, ['foo', 'abc', 'def'])).toMatchInlineSnapshot(`"["abc","def"]"`)
  expect((await output(cli, ['foo', '--help'])).split('\n')[0]).toMatchInlineSnapshot(
    `"Usage: program foo [options] <files...>"`,
  )
  expect((await output(cli, ['bar', '--help'])).split('\n')[0]).toMatchInlineSnapshot(
    `"Usage: program bar [options] <files...>"`,
  )
  expect((await output(cli, ['baz', '--help'])).split('\n')[0]).toMatchInlineSnapshot(
    `"Usage: program baz [options] <file collection...>"`,
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
