import {initTRPC} from 'trpcserver11'
import {inspect} from 'util'
import * as v from 'valibot'
import {expect, test} from 'vitest'
import {AnyRouter, createCli, TrpcCliMeta, TrpcCliParams} from '../src'
import {looksLikeInstanceof} from '../src/util'

expect.addSnapshotSerializer({
  test: val => looksLikeInstanceof(val, Error),
  serialize(val, config, indentation, depth, refs, printer) {
    let topLine = `${val.constructor.name}: ${val.message}`
    if (val.constructor.name === 'FailedToExitError') topLine = `CLI exited with code ${val.exitCode}`

    if (!val.cause) return topLine
    indentation += '  '
    return `${topLine}\n${indentation}Caused by: ${printer(val.cause, config, indentation, depth + 1, refs)}`
      .split(/(---|Usage:)/)[0] // strip out the usage line and the --- line which is added for debugging when tests fail
      .trim()
  },
})

const t = initTRPC.meta<TrpcCliMeta>().create()

const run = <R extends AnyRouter>(router: R, argv: string[]) => {
  return runWith({router}, argv)
}
const runWith = <R extends AnyRouter>(params: TrpcCliParams<R>, argv: string[]) => {
  const cli = createCli({trpcServer: import('trpcserver11'), ...params})
  const logs = [] as unknown[][]
  const addLogs = (...args: unknown[]) => logs.push(args)
  return cli
    .run({
      argv,
      logger: {info: addLogs, error: addLogs},
      process: {exit: _ => 0 as never},
    })
    .catch(e => {
      if (e.exitCode === 0 && e.cause.message === '(outputHelp)') return logs[0][0] // should be the help text
      if (e.exitCode === 0) return e.cause
      throw e
    })
}

test('merging input types', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.object({bar: v.string()}))
      .input(v.object({baz: v.number()}))
      .input(v.object({qux: v.boolean()}))
      .query(({input}) => Object.entries(input).join(', ')),
  })

  expect(await run(router, ['foo', '--bar', 'hello', '--baz', '42', '--qux'])).toMatchInlineSnapshot(
    `"bar,hello, baz,42, qux,true"`,
  )
})

test('string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.string()) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'hello'])).toMatchInlineSnapshot(`""hello""`)
})

test('enum input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.union([v.literal('aa'), v.literal('bb')])) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'aa'])).toMatchInlineSnapshot(`""aa""`)
  await expect(run(router, ['foo', 'cc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Invalid type: Expected ("aa" | "bb") but received "cc"
  `)
})

test('number input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.number()) //
      .query(({input}) => JSON.stringify({input})),
  })

  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"{"input":1}"`)
  await expect(run(router, ['foo', 'a'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Invalid type: Expected number but received "a"
  `)
})

test('boolean input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.boolean()) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'true'])).toMatchInlineSnapshot(`"true"`)
  expect(await run(router, ['foo', 'false'])).toMatchInlineSnapshot(`"false"`)
  await expect(run(router, ['foo', 'a'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Invalid type: Expected boolean but received "a"
  `)
})

test('refine in a union pedantry', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        v.union([
          v.string(),
          v.pipe(
            v.number(),
            v.custom(n => Number.isInteger(n)),
          ),
        ]),
      ) //
      .query(({input}) => JSON.stringify(input)),
  })

  // Valibot should handle this better than arktype did
  await expect(run(router, ['foo', '--help'])).resolves.toMatchInlineSnapshot(`
    "Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Failed to convert input to JSON
                      Schema: A "pipe" with multiple schemas cannot be converted to
                      JSON Schema.)
      -h, --help      display help for command
    "
  `)
  // expect(await run(router, ['foo', '11'])).toBe(JSON.stringify(11))
  // expect(await run(router, ['foo', 'aa'])).toBe(JSON.stringify('aa'))
  // expect(await run(router, ['foo', '1.1'])).toBe(JSON.stringify('1.1')) // technically this *does* match one of the types in the union, just not the number type because that demands ints - it matches the string type
})

test('transform in a union', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        v.union([
          v.string(),
          v.pipe(
            v.pipe(
              v.number(),
              v.custom(n => Number.isInteger(n)),
            ),
            v.transform(n => `Roman numeral: ${'I'.repeat(n)}`),
          ),
        ]),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '--help'])).toMatchInlineSnapshot(`
    "Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Failed to convert input to JSON
                      Schema: A "pipe" with multiple schemas cannot be converted to
                      JSON Schema.)
      -h, --help      display help for command
    "
  `)
  // expect(await run(router, ['foo', '3'])).toMatchInlineSnapshot(`""Roman numeral: III""`)
  // expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  // expect(await run(router, ['foo', '3.3'])).toMatchInlineSnapshot(`""3.3""`)
})

test('literal input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.literal(2)) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '2'])).toMatchInlineSnapshot(`"2"`)
  await expect(run(router, ['foo', '3'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Invalid type: Expected 2 but received 3
  `)
})

test('optional input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.optional(v.string())) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', '--help'])).toMatchInlineSnapshot(`
    "Usage: program foo [options] <string>

    Arguments:
      string      a string of some kind (required)

    Options:
      -h, --help  display help for command
    "
  `)
  // expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  // expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"null"`)
})

test('union input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.union([v.number(), v.string()])) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"1"`)
})

test('regex input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.pipe(v.string(), v.regex(/hello/), v.description('greeting'))) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'hello abc'])).toMatchInlineSnapshot(`""hello abc""`)
  await expect(run(router, ['foo', 'goodbye xyz'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Invalid format: Expected /hello/ but received "goodbye xyz"
  `)
})

test('boolean, number, string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        v.union([v.string(), v.number(), v.boolean()]), //
      )
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'true'])).toMatchInlineSnapshot(`"true"`)
  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"1"`)
  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
})

test('tuple input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.tuple([v.string(), v.number()])) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'hello', '123'])).toMatchInlineSnapshot(`"["hello",123]"`)
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CliValidationError: Invalid type: Expected number but received "not a number!"
    `,
  )
})

test('tuple input with flags', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        v.tuple([
          v.string(),
          v.number(),
          v.object({foo: v.string()}), //
        ]),
      )
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'hello', '123', '--foo', 'bar'])).toMatchInlineSnapshot(
    `"["hello",123,{"foo":"bar"}]"`,
  )
  await expect(run(router, ['foo', 'hello', '123'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CommanderError: error: required option '--foo <string>' not specified
    `,
  )
  await expect(run(router, ['foo', 'hello', 'not a number!', '--foo', 'bar'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CliValidationError: Invalid type: Expected number but received "not a number!"
    `,
  )
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CommanderError: error: required option '--foo <string>' not specified
    `,
  )
})

test('single character flag', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.object({a: v.string()})) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
})

test('custom default procedure', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({default: true})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  const yarnOutput = await runWith(params, ['--frozen-lockfile'])
  expect(yarnOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)

  const yarnInstallOutput = await runWith(params, ['install', '--frozen-lockfile'])
  expect(yarnInstallOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('command alias', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({aliases: {command: ['i']}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  const yarnIOutput = await runWith(params, ['i', '--frozen-lockfile'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('flag alias', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({aliases: {flags: {frozenLockfile: 'x'}}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  const yarnIOutput = await runWith(params, ['install', '-x'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('flag alias can be two characters', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({aliases: {flags: {frozenLockfile: 'xx'}}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  const yarnIOutput = await runWith(params, ['install', '--xx'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('flag alias typo', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({aliases: {flags: {frooozenLockfile: 'x'}}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  await expect(runWith(params, ['install', '-x'])).rejects.toMatchInlineSnapshot(
    `Error: Invalid flag aliases: frooozenLockfile: x`,
  )
})

test('validation', async () => {
  const router = t.router({
    tupleOfStrings: t.procedure
      .input(
        v.tuple([
          v.pipe(v.string(), v.description('the first string')),
          v.pipe(v.string(), v.description('the second string')),
        ]),
      )
      .query(() => 'ok'),
    tupleWithBoolean: t.procedure
      .input(v.tuple([v.string(), v.boolean()])) //
      .query(() => 'ok'),
    tupleWithBooleanThenObject: t.procedure
      .input(v.tuple([v.string(), v.boolean(), v.object({foo: v.string()})]))
      .query(() => 'ok'),
    tupleWithObjectInTheMiddle: t.procedure
      .input(v.tuple([v.string(), v.object({foo: v.string()}), v.string()]))
      .query(() => 'ok'),
    tupleWithRecord: t.procedure
      .input(v.tuple([v.string(), v.record(v.string(), v.string())])) //
      .query(() => 'ok'),
  })
  const cli = createCli({router})
  expect(cli).toBeDefined()
})

test('string array input', async () => {
  const router = t.router({
    stringArray: t.procedure
      .input(v.array(v.string())) //
      .query(({input}) => `strings: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['stringArray', 'hello', 'world'])
  expect(result).toMatchInlineSnapshot(`"strings: ["hello","world"]"`)
})

test('number array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(v.array(v.number())) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', '1', '2', '3', '4'])
  expect(result).toMatchInlineSnapshot(`"list: [1,2,3,4]"`)

  await expect(run(router, ['test', '1', 'bad'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Invalid type: Expected number but received "bad"
  `)
})

test('number array input with constraints', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        v.array(
          v.pipe(
            v.number(),
            v.custom(n => Number.isInteger(n)),
          ),
        ),
      ) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  await expect(run(router, ['foo', '--help'])).resolves.toMatchInlineSnapshot(`
    "Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Failed to convert input to JSON
                      Schema: A "pipe" with multiple schemas cannot be converted to
                      JSON Schema.)
      -h, --help      display help for command
    "
  `)
})

test('boolean array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(v.array(v.boolean())) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', 'true', 'false', 'true'])
  expect(result).toMatchInlineSnapshot(`"list: [true,false,true]"`)

  await expect(run(router, ['test', 'true', 'bad'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Invalid type: Expected boolean but received "bad"
  `)
})

test('mixed array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(v.array(v.union([v.boolean(), v.number(), v.string()]))) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', '12', 'true', '3.14', 'null', 'undefined', 'hello'])
  expect(result).toMatchInlineSnapshot(`"list: [12,true,3.14,"null","undefined","hello"]"`)
})

test("nullable array inputs aren't supported", async () => {
  const router = t.router({
    test1: t.procedure.input(v.array(v.nullable(v.string()))).query(({input}) => `list: ${JSON.stringify(input)}`),
    test2: t.procedure
      .input(v.array(v.nullable(v.union([v.boolean(), v.number(), v.string()])))) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  await expect(run(router, ['test1', '--help'])).resolves.toMatchInlineSnapshot(`
    "Usage: program test1 [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Invalid input type Array<string |
                      null>. Nullable arrays are not supported.)
      -h, --help      display help for command
    "
  `)
  const result = await run(router, ['test1', '--input', JSON.stringify(['a', null, 'b'])])
  expect(result).toMatchInlineSnapshot(`"list: ["a",null,"b"]"`)

  await expect(run(router, ['test2', '--help'])).resolves.toMatchInlineSnapshot(`
    "Usage: program test2 [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Invalid input type Array<boolean |
                      number | string | null>. Nullable arrays are not supported.)
      -h, --help      display help for command
    "
  `)
})

test('string array input with options', async () => {
  const router = t.router({
    test: t.procedure
      .input(
        v.tuple([
          v.array(v.string()), //
          v.object({foo: v.optional(v.string())}),
        ]),
      )
      .query(({input}) => `input: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', 'hello', 'world', '--foo', 'bar'])
  expect(result).toMatchInlineSnapshot(`"input: [["hello","world"],{"foo":"bar"}]"`)

  const result2 = await run(router, ['test', '--foo', 'bar', 'hello', 'world'])
  expect(result2).toMatchInlineSnapshot(`"input: [["hello","world"],{"foo":"bar"}]"`)

  const result3 = await run(router, ['test', 'hello', '--foo=bar', 'world'])
  expect(result3).toMatchInlineSnapshot(`"input: [["hello","world"],{"foo":"bar"}]"`)
})

test('mixed array input with options', async () => {
  const router = t.router({
    test: t.procedure
      .input(
        v.tuple([
          v.array(v.union([v.string(), v.number()])), //
          v.object({foo: v.optional(v.string())}),
        ]),
      ) //
      .query(({input}) => `input: ${JSON.stringify(input)}`),
  })

  const result0 = await run(router, ['test', 'hello', '1', 'world'])
  expect(result0).toMatchInlineSnapshot(`"input: [["hello",1,"world"],{}]"`)

  const result1 = await run(router, ['test', 'hello', '1', 'world', '--foo', 'bar'])
  expect(result1).toMatchInlineSnapshot(`"input: [["hello",1,"world"],{"foo":"bar"}]"`)

  const result2 = await run(router, ['test', '--foo', 'bar', 'hello', '1', 'world'])
  expect(result2).toMatchInlineSnapshot(`"input: [["hello",1,"world"],{"foo":"bar"}]"`)

  const result3 = await run(router, ['test', 'hello', 'world', '--foo=bar', '1'])
  expect(result3).toMatchInlineSnapshot(`"input: [["hello","world",1],{"foo":"bar"}]"`)
})

// valibot handles defaults via JSON schema
test('defaults and negations', async () => {
  const router = t.router({
    normalBoolean: t.procedure.input(v.object({foo: v.boolean()})).query(({input}) => `${inspect(input)}`),
    optionalBoolean: t.procedure
      .input(v.object({foo: v.optional(v.boolean())}))
      .query(({input}) => `${inspect(input)}`),
    defaultTrueBoolean: t.procedure
      .input(v.object({foo: v.optional(v.boolean(), true)}))
      .query(({input}) => `${inspect(input)}`),
    defaultFalseBoolean: t.procedure
      .input(v.object({foo: v.optional(v.boolean(), false)}))
      .query(({input}) => `${inspect(input)}`),
    booleanOrNumber: t.procedure
      .input(v.object({foo: v.union([v.boolean(), v.number()])}))
      .query(({input}) => `${inspect(input)}`),
    booleanOrString: t.procedure
      .input(v.object({foo: v.union([v.boolean(), v.string()])}))
      .query(({input}) => `${inspect(input)}`),
    arrayOfBooleanOrNumber: t.procedure
      .input(v.object({foo: v.array(v.union([v.boolean(), v.number()]))}))
      .query(({input}) => `${inspect(input)}`),
  })

  expect(await run(router, ['normalBoolean'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['normalBoolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)

  expect(await run(router, ['optionalBoolean'])).toMatchInlineSnapshot(`"{}"`)
  expect(await run(router, ['optionalBoolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optionalBoolean', '--foo', 'true'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optionalBoolean', '--foo', 'false'])).toMatchInlineSnapshot(`"{ foo: false }"`)

  expect(await run(router, ['defaultTrueBoolean'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['defaultTrueBoolean', '--no-foo'])).toMatchInlineSnapshot(`"{ foo: false }"`)

  expect(await run(router, ['defaultFalseBoolean'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['defaultFalseBoolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)

  expect(await run(router, ['booleanOrNumber'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['booleanOrNumber', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['booleanOrNumber', '--foo', 'false'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['booleanOrNumber', '--foo', 'true'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['booleanOrNumber', '--foo', '1'])).toMatchInlineSnapshot(`"{ foo: 1 }"`)

  expect(await run(router, ['booleanOrString'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['booleanOrString', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['booleanOrString', '--foo', '1'])).toMatchInlineSnapshot(`"{ foo: '1' }"`)
  expect(await run(router, ['booleanOrString', '--foo', 'a'])).toMatchInlineSnapshot(`"{ foo: 'a' }"`)

  expect(await run(router, ['arrayOfBooleanOrNumber'])).toMatchInlineSnapshot(`"{ foo: [] }"`)
  expect(await run(router, ['arrayOfBooleanOrNumber', '--foo', 'true'])).toMatchInlineSnapshot(`"{ foo: [ true ] }"`)
  expect(await run(router, ['arrayOfBooleanOrNumber', '--foo', '1'])).toMatchInlineSnapshot(`"{ foo: [ 1 ] }"`)
  expect(await run(router, ['arrayOfBooleanOrNumber', '--foo', '--foo', '1'])).toMatchInlineSnapshot(`"{ foo: [ 1 ] }"`)
  expect(await run(router, ['arrayOfBooleanOrNumber', '--foo', 'true', '1'])).toMatchInlineSnapshot(
    `"{ foo: [ true, 1 ] }"`,
  )
})

test('valibot schemas to JSON schema', () => {
  const toJsonSchema = (schema: any) => {
    try {
      return require('@valibot/to-json-schema').toJsonSchema(schema)
    } catch (e) {
      return e
    }
  }

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.number(),
          v.custom(n => Number.isInteger(n)),
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`Error: A "pipe" with multiple schemas cannot be converted to JSON Schema.`)

  expect(
    toJsonSchema(
      v.pipe(
        v.number(),
        v.custom(n => Number.isInteger(n)),
      ),
    ),
  ).toMatchInlineSnapshot(`Error: A "pipe" with multiple schemas cannot be converted to JSON Schema.`)

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.number(),
          v.transform(n => `Roman numeral: ${'I'.repeat(n)}`),
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`Error: The "transform" action cannot be converted to JSON Schema.`)

  expect(toJsonSchema(v.object({foo: v.optional(v.string(), 'hi')}))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "properties": {
        "foo": {
          "default": "hi",
          "type": "string",
        },
      },
      "required": [],
      "type": "object",
    }
  `)

  expect(toJsonSchema(v.pipe(v.string(), v.regex(/foo.*bar/)))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "pattern": "foo.*bar",
      "type": "string",
    }
  `)

  expect(toJsonSchema(v.pipe(v.string(), v.description('a piece of text')))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "description": "a piece of text",
      "type": "string",
    }
  `)
})
