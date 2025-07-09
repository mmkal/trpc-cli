import {inspect} from 'util'
import * as v from 'valibot'
import {expect, test} from 'vitest'
import {createCli, TrpcCliMeta, trpcServer} from '../src'
import {run, snapshotSerializer} from './test-run'

expect.addSnapshotSerializer(snapshotSerializer)

const t = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

// codegen:start {preset: custom, source: ./validation-library-codegen.ts, export: testSuite}
// NOTE: the below tests are ✨generated✨ based on the hand-written tests in ../zod3.test.ts
// But the zod types are expected to be replaced with equivalent types (written by hand).
// If you change anything other than `.input(...)` types, the linter will just undo your changes.

test('merging input types', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.object({bar: v.string()}))
      .input(v.object({baz: v.number()}))
      .input(v.object({qux: v.boolean()}))
      .query(({input}) => JSON.stringify({bar: input.bar, baz: input.baz, qux: input.qux})),
  })

  expect(await run(router, ['foo', '--bar', 'hello', '--baz', '42', '--qux'])).toMatchInlineSnapshot(
    `"{"bar":"hello","baz":42,"qux":true}"`,
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
      Caused by: CliValidationError: ✖ Invalid type: Expected ("aa" | "bb") but received "cc"
  `)
})

test('number input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.number()) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"1"`)
  await expect(run(router, ['foo', 'a'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: command-argument value 'a' is invalid for argument 'number'. Invalid number: a
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
      Caused by: CliValidationError: ✖ Invalid type: Expected boolean but received "a"
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
            v.integer(), //
          ),
        ]),
      ) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '11'])).toBe(JSON.stringify(11))
  expect(await run(router, ['foo', 'aa'])).toBe(JSON.stringify('aa'))
  expect(await run(router, ['foo', '1.1'])).toBe(JSON.stringify('1.1')) // technically this *does* match one of the types in the union, just not the number type because that demands ints - it matches the string type
})

test('transform in a union', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        v.union([
          v.string(),
          v.pipe(
            v.pipe(v.number(), v.integer()),
            v.transform(n => `Roman numeral: ${'I'.repeat(n)}`),
          ),
        ]),
      ) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '3'])).toMatchInlineSnapshot(`""Roman numeral: III""`)
  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo', '3.3'])).toMatchInlineSnapshot(`""3.3""`)
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
      Caused by: CliValidationError: ✖ Invalid type: Expected 2 but received 3
  `)
})

test('optional input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.optional(v.string())) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"null"`)
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
  // todo: raise a zod-validation-error issue 👇 not a great error message
  await expect(run(router, ['foo', 'goodbye xyz'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid format: Expected /hello/ but received "goodbye xyz"
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
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: command-argument value 'not a number!' is invalid for argument 'parameter_2'. Invalid number: not a number!
  `)
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
  await expect(run(router, ['foo', 'hello', '123'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: required option '--foo <string>' not specified
  `)
  await expect(run(router, ['foo', 'hello', 'not a number!', '--foo', 'bar'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: command-argument value 'not a number!' is invalid for argument 'parameter_2'. Invalid number: not a number!
  `)
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: required option '--foo <string>' not specified
  `)
})

test('single character option', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.object({a: v.string()})) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
})

test('custom default procedure', async () => {
  const router = t.router({
    install: t.procedure
      .meta({default: true})
      .input(v.object({cwd: v.string()})) // let's pretend cwd is a required option
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnOutput = await run(router, ['--cwd', '/foo/bar'])
  expect(yarnOutput).toMatchInlineSnapshot(`"install: {"cwd":"/foo/bar"}"`)

  const yarnInstallOutput = await run(router, ['install', '--cwd', '/foo/bar'])
  expect(yarnInstallOutput).toMatchInlineSnapshot(`"install: {"cwd":"/foo/bar"}"`)
})

test('command alias', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {command: ['i']}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['i', '--frozen-lockfile'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'x'}}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['install', '-x'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias can be two characters', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'xx'}}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['install', '--xx'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias typo', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frooozenLockfile: 'x'}}})
      .input(v.object({frozenLockfile: v.boolean()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  await expect(run(router, ['install', '-x'])).rejects.toMatchInlineSnapshot(
    `Error: Invalid option aliases: frooozenLockfile: x`,
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

  const result = await run(router, ['string-array', 'hello', 'world'])
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
      Caused by: CliValidationError: ✖ Invalid type: Expected number but received "bad" → at [1]
  `)
})

test('number array input with constraints', async () => {
  const router = t.router({
    foo: t.procedure
      .input(v.array(v.pipe(v.number(), v.integer()))) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  await expect(run(router, ['foo', '1.2'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid type: Expected number but received "1.2" → at [0]
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
      Caused by: CliValidationError: ✖ Invalid type: Expected boolean but received "bad" → at [1]
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

test('number then string array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(v.tuple([v.number(), v.array(v.string())])) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  expect(await run(router, ['test', '123', 'hello', 'world'])).toMatchInlineSnapshot(`"list: [123,["hello","world"]]"`)
})

test('string array then number input (downgrades to json input)', async () => {
  const router = t.router({
    test: t.procedure
      .input(v.tuple([v.array(v.string()), v.number()])) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  expect(await run(router, ['test', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
    "Usage: program test [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Array positional parameters must
                      be at the end of the input.)
      -h, --help      display help for command
    "
  `)
  expect(
    await run(router, ['test', '--input', '[["hello","world"], 123]'], {expectJsonInput: true}),
  ).toMatchInlineSnapshot(`"list: [["hello","world"],123]"`)
})

test('record input', async () => {
  const router = t.router({
    test: t.procedure
      .input(v.optional(v.record(v.string(), v.number()))) //
      .query(({input}) => `input: ${JSON.stringify(input)}`),
  })

  expect(await run(router, ['test', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
    "Usage: program test [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Inputs with additional properties
                      are not currently supported)
      -h, --help      display help for command
    "
  `)
  expect(await run(router, ['test'])).toMatchInlineSnapshot(`"input: undefined"`)
  expect(await run(router, ['test', '--input', '{"foo": 1}'])).toMatchInlineSnapshot(`"input: {"foo":1}"`)
  await expect(run(router, ['test', '--input', '{"foo": "x"}'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid type: Expected number but received "x" → at foo
  `)
})

test("nullable array inputs aren't supported", async () => {
  const router = t.router({
    test1: t.procedure.input(v.array(v.nullable(v.string()))).query(({input}) => `list: ${JSON.stringify(input)}`),
    test2: t.procedure
      .input(v.array(v.nullable(v.union([v.boolean(), v.number(), v.string()])))) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  await expect(run(router, ['test1', '--help'], {expectJsonInput: true})).resolves.toMatchInlineSnapshot(`
    "Usage: program test1 [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Invalid input type Array<string |
                      null>. Nullable arrays are not supported.)
      -h, --help      display help for command
    "
  `)
  const result = await run(router, ['test1', '--input', JSON.stringify(['a', null, 'b'])], {expectJsonInput: true})
  expect(result).toMatchInlineSnapshot(`"list: ["a",null,"b"]"`)

  await expect(run(router, ['test2', '--help'], {expectJsonInput: true})).resolves.toMatchInlineSnapshot(`
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

  expect(await run(router, ['normal-boolean'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['normal-boolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)

  expect(await run(router, ['optional-boolean'])).toMatchInlineSnapshot(`"{}"`)
  expect(await run(router, ['optional-boolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optional-boolean', '--foo', 'true'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optional-boolean', '--foo', 'false'])).toMatchInlineSnapshot(`"{ foo: false }"`)

  expect(await run(router, ['default-true-boolean'])).toMatchInlineSnapshot(`"{ foo: true }"`)

  expect(await run(router, ['default-false-boolean'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['default-false-boolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)

  expect(await run(router, ['boolean-or-number'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['boolean-or-number', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['boolean-or-number', '--foo', 'false'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['boolean-or-number', '--foo', 'true'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['boolean-or-number', '--foo', '1'])).toMatchInlineSnapshot(`"{ foo: 1 }"`)

  expect(await run(router, ['boolean-or-string'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['boolean-or-string', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['boolean-or-string', '--foo', '1'])).toMatchInlineSnapshot(`"{ foo: '1' }"`)
  expect(await run(router, ['boolean-or-string', '--foo', 'a'])).toMatchInlineSnapshot(`"{ foo: 'a' }"`)

  expect(await run(router, ['array-of-boolean-or-number'])).toMatchInlineSnapshot(`"{ foo: [] }"`)
  expect(await run(router, ['array-of-boolean-or-number', '--foo', 'true'])).toMatchInlineSnapshot(
    `"{ foo: [ true ] }"`,
  )
  expect(await run(router, ['array-of-boolean-or-number', '--foo', '1'])).toMatchInlineSnapshot(`"{ foo: [ 1 ] }"`)
  expect(await run(router, ['array-of-boolean-or-number', '--foo', '--foo', '1'])).toMatchInlineSnapshot(
    `"{ foo: [ 1 ] }"`,
  )
  expect(await run(router, ['array-of-boolean-or-number', '--foo', 'true', '1'])).toMatchInlineSnapshot(
    `"{ foo: [ true, 1 ] }"`,
  )
})
// codegen:end

test('valibot schemas to JSON schema', () => {
  // just a test to quickly see how valibot schemas are converted to JSON schema
  // honestly not a test of trpc-cli at all but useful for debugging
  const toJsonSchema = (schema: any) => {
    try {
      return require('@valibot/to-json-schema').toJsonSchema(schema, {errorMode: 'ignore'})
    } catch (e) {
      return e
    }
  }

  expect(toJsonSchema(v.optional(v.string()))).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "string",
    }
  `)

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.number(),
          v.integer(), //
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "integer",
        },
      ],
    }
  `)

  expect(
    toJsonSchema(
      v.union([
        v.string(),
        v.pipe(
          v.number(),
          v.custom(n => Number.isInteger(n)), // note: avoid this - the resultant JSON schema doesn't know the number must be an integer
        ),
      ]),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "number",
        },
      ],
    }
  `)

  expect(
    toJsonSchema(
      v.pipe(
        v.number(),
        v.custom(n => Number.isInteger(n)),
      ),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "number",
    }
  `)

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
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "number",
        },
      ],
    }
  `)

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

  expect(
    toJsonSchema(
      v.pipe(
        v.union([
          v.string(),
          v.pipe(
            v.number(),
            v.integer(), //
          ),
        ]),
        v.transform(u => ({u})),
      ),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "integer",
        },
      ],
    }
  `)

  expect(
    toJsonSchema(
      v.array(
        v.pipe(
          v.number(),
          v.custom(n => Number.isInteger(n)),
        ),
      ),
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "items": {
        "type": "number",
      },
      "type": "array",
    }
  `)

  expect(
    toJsonSchema(
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
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "anyOf": [
        {
          "type": "string",
        },
        {
          "type": "number",
        },
      ],
    }
  `)
})
