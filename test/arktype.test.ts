import {type} from 'arktype'
import {initTRPC} from 'trpcserver11'
import {inspect} from 'util'
import {expect, test} from 'vitest'
import {AnyRouter, createCli, TrpcCliMeta, TrpcCliParams} from '../src'
import {looksLikeInstanceof} from '../src/util'

expect.addSnapshotSerializer({
  test: val => typeof val === 'string' && /\$ark\.fn\d+\b/.test(val),
  serialize(val) {
    return val.replaceAll(/\$ark\.fn\d+\b/g, '$ark.fn...')
  },
})

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
      .input(type({bar: 'string'}))
      .input(type({baz: 'number'}))
      .input(type({qux: 'boolean'}))
      .query(({input}) => Object.entries(input).join(', ')),
  })

  expect(await run(router, ['foo', '--bar', 'hello', '--baz', '42', '--qux'])).toMatchInlineSnapshot(
    `"bar,hello, baz,42, qux,true"`,
  )
})

test('string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('string')) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'hello'])).toMatchInlineSnapshot(`""hello""`)
})

test('enum input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('"aa" | "bb"')) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'aa'])).toMatchInlineSnapshot(`""aa""`)
  await expect(run(router, ['foo', 'cc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: must be "aa" or "bb" (was "cc")
  `)
})

test('number input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('number')) //
      .query(({input}) => JSON.stringify({input})),
  })

  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"{"input":1}"`)
  await expect(run(router, ['foo', 'a'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: must be a number (was a string)
  `)
})

test('boolean input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('boolean')) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'true'])).toMatchInlineSnapshot(`"true"`)
  expect(await run(router, ['foo', 'false'])).toMatchInlineSnapshot(`"false"`)
  await expect(run(router, ['foo', 'a'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: must be boolean (was "a")
  `)
})

test('refine in a union pedantry', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        type('string').or(
          type('number').narrow(n => Number.isInteger(n)), //
        ),
      ) //
      .query(({input}) => JSON.stringify(input)),
  })

  // todo: arktype doesn't make it easy to extract the "in" type from a complex-ish type (in this case a union, where one of the constituents has a predicate)
  await expect(run(router, ['foo', '--help'])).resolves.toMatchInlineSnapshot(`
    Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Failed to convert input to JSON
                      Schema: Predicate $ark.fn... is not convertible to JSON Schema)
      -h, --help      display help for command
  `)
  // expect(await run(router, ['foo', '11'])).toBe(JSON.stringify(11))
  // expect(await run(router, ['foo', 'aa'])).toBe(JSON.stringify('aa'))
  // expect(await run(router, ['foo', '1.1'])).toBe(JSON.stringify('1.1')) // technically this *does* match one of the types in the union, just not the number type because that demands ints - it matches the string type
})

test('transform in a union', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        type('string').or(
          type('number') // arktype's .toJsonSchema() can't handle types this complex so we end up with json input
            .narrow(n => Number.isInteger(n))
            .pipe(n => `Roman numeral: ${'I'.repeat(n)}`),
        ),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  // todo: arktype can hopefully address the below problem
  expect(await run(router, ['foo', '--help'])).toMatchInlineSnapshot(`
    Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Failed to convert input to JSON
                      Schema: Predicate $ark.fn... is not convertible to JSON Schema)
      -h, --help      display help for command
  `)
  // expect(await run(router, ['foo', '3'])).toMatchInlineSnapshot(`""Roman numeral: III""`)
  // expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  // expect(await run(router, ['foo', '3.3'])).toMatchInlineSnapshot(`""3.3""`)
})

test('literal input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('2')) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '2'])).toMatchInlineSnapshot(`"2"`)
  await expect(run(router, ['foo', '3'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: must be 2 (was 3)
  `)
})

test('optional input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('string | undefined')) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  // not sure if arktype can/should handle this, since it's kind of right that undefined is not convertible to JSON Schema.
  // but it's handy that zod-to-json-schema isn't so strict - maybe arktype could let you configure it?
  expect(await run(router, ['foo', '--help'])).toMatchInlineSnapshot(`
    "Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Failed to convert input to JSON
                      Schema: undefined is not convertible to JSON Schema)
      -h, --help      display help for command
    "
  `)
  // expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  // expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"null"`)
})

test('union input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('number | string')) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"1"`)
})

test('regex input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('/hello/').describe('greeting')) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'hello abc'])).toMatchInlineSnapshot(`""hello abc""`)
  await expect(run(router, ['foo', 'goodbye xyz'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: must be greeting (was "goodbye xyz")
  `)
})

test('boolean, number, string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        type('string | number | boolean'), //
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
      .input(type(['string', 'number'])) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'hello', '123'])).toMatchInlineSnapshot(`"["hello",123]"`)
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CliValidationError: value at [1] must be a number (was a string)
    `,
  )
})

test('tuple input with flags', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        type([
          'string',
          'number',
          {foo: 'string'}, //
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
        Caused by: CliValidationError: value at [1] must be a number (was a string)
    `,
  )
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(
    `
      CLI exited with code 1
        Caused by: CommanderError: error: required option '--foo <string>' not specified
    `,
  )
})

test('single character option', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type({a: 'string'})) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
})

test('custom default procedure', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({default: true})
      .input(type({frozenLockfile: 'boolean'}))
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
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  const yarnIOutput = await runWith(params, ['i', '--frozen-lockfile'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'x'}}})
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  const yarnIOutput = await runWith(params, ['install', '-x'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias can be two characters', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'xx'}}})
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  const yarnIOutput = await runWith(params, ['install', '--xx'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias typo', async () => {
  const yarn = t.router({
    install: t.procedure
      .meta({aliases: {options: {frooozenLockfile: 'x'}}})
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {router: yarn}

  await expect(runWith(params, ['install', '-x'])).rejects.toMatchInlineSnapshot(
    `Error: Invalid option aliases: frooozenLockfile: x`,
  )
})

test('validation', async () => {
  const router = t.router({
    tupleOfStrings: t.procedure
      .input(type([type('string', '@', 'the first string'), type('string', '@', 'the second string')]))
      .query(() => 'ok'),
    tupleWithBoolean: t.procedure
      .input(type([type('string'), type('boolean')])) //
      .query(() => 'ok'),
    tupleWithBooleanThenObject: t.procedure
      .input(type([type('string'), type('boolean'), type({foo: 'string'})]))
      .query(() => 'ok'),
    tupleWithObjectInTheMiddle: t.procedure
      .input(type([type('string'), type({foo: 'string'}), type('string')]))
      .query(() => 'ok'),
    tupleWithRecord: t.procedure
      .input(type([type('string'), type('Record<string, string>')])) //
      .query(() => 'ok'),
  })
  const cli = createCli({router})
  expect(cli).toBeDefined()
})

test('string array input', async () => {
  const router = t.router({
    stringArray: t.procedure
      .input(type('string[]')) //
      .query(({input}) => `strings: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['stringArray', 'hello', 'world'])
  expect(result).toMatchInlineSnapshot(`"strings: ["hello","world"]"`)
})

test('number array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(type('number[]')) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', '1', '2', '3', '4'])
  expect(result).toMatchInlineSnapshot(`"list: [1,2,3,4]"`)

  await expect(run(router, ['test', '1', 'bad'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: value at [1] must be a number (was a string)
  `)
})

test('number array input with constraints', async () => {
  const router = t.router({
    foo: t.procedure
      .input(type('number[]').narrow(n => Number.isInteger(n))) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  // todo: hopefully get the below problem addressed in arktype
  await expect(run(router, ['foo', '--help'])).resolves.toMatchInlineSnapshot(`
    Usage: program foo [options]

    Options:
      --input [json]  Input formatted as JSON (procedure's schema couldn't be
                      converted to CLI arguments: Failed to convert input to JSON
                      Schema: Predicate $ark.fn... is not convertible to JSON Schema)
      -h, --help      display help for command
  `)
  // await expect(run(router, ['foo', '1.2'])).rejects.toMatchInlineSnapshot(`
  //   CLI exited with code 1
  //     Caused by: Logs: Validation error
  //     - Expected number, received string at index 0
  // `)
})

test('boolean array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(type('boolean[]')) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', 'true', 'false', 'true'])
  expect(result).toMatchInlineSnapshot(`"list: [true,false,true]"`)

  await expect(run(router, ['test', 'true', 'bad'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: [1] must be boolean (was "bad")
  `)
})

test('mixed array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(type('(boolean | number | string)[]')) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', '12', 'true', '3.14', 'null', 'undefined', 'hello'])
  expect(result).toMatchInlineSnapshot(`"list: [12,true,3.14,"null","undefined","hello"]"`)
})

test("nullable array inputs aren't supported", async () => {
  const router = t.router({
    test1: t.procedure.input(type('(string | null)[]')).query(({input}) => `list: ${JSON.stringify(input)}`),
    test2: t.procedure
      .input(type('(boolean | number | string | null)[]')) //
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
                      converted to CLI arguments: Invalid input type Array<number |
                      string | boolean | null>. Nullable arrays are not supported.)
      -h, --help      display help for command
    "
  `)
})

test('string array input with options', async () => {
  const router = t.router({
    test: t.procedure
      .input(
        type([
          type('string[]'), //
          type({'foo?': 'string'}),
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
        type([
          type('(string | number)[]'), //
          type({'foo?': 'string'}),
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

// arktype doesn't propagate defaults to json schema
test('defaults and negations', async () => {
  const router = t.router({
    normalBoolean: t.procedure.input(type({foo: 'boolean'})).query(({input}) => `${inspect(input)}`),
    optionalBoolean: t.procedure.input(type({'foo?': 'boolean'})).query(({input}) => `${inspect(input)}`),
    defaultTrueBoolean: t.procedure
      .input(type({foo: type('boolean').default(true)}))
      .query(({input}) => `${inspect(input)}`),
    defaultFalseBoolean: t.procedure
      .input(type({foo: type('boolean').default(false)}))
      .query(({input}) => `${inspect(input)}`),
    booleanOrNumber: t.procedure.input(type({foo: type('boolean | number')})).query(({input}) => `${inspect(input)}`),
    booleanOrString: t.procedure.input(type({foo: type('boolean | string')})).query(({input}) => `${inspect(input)}`),
    arrayOfBooleanOrNumber: t.procedure
      .input(type({foo: type('(boolean | number)[]')}))
      .query(({input}) => `${inspect(input)}`),
  })

  expect(await run(router, ['normalBoolean'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['normalBoolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)

  expect(await run(router, ['optionalBoolean'])).toMatchInlineSnapshot(`"{}"`)
  expect(await run(router, ['optionalBoolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optionalBoolean', '--foo', 'true'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optionalBoolean', '--foo', 'false'])).toMatchInlineSnapshot(`"{ foo: false }"`)

  expect(await run(router, ['defaultTrueBoolean'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  // todo: make this work - arktype doesn't report defaults to the produced json schema so we don't know to add the negation option
  // expect(await run(router, ['defaultTrueBoolean', '--no-foo'])).toMatchInlineSnapshot(`"{ foo: false }"`)

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

test('arktype issues', () => {
  const toJsonSchema = (schema: type.Any) => {
    try {
      return schema.toJsonSchema()
    } catch (e) {
      return e
    }
  }

  expect(
    toJsonSchema(
      type('string').or(
        type('number').narrow(n => Number.isInteger(n)), //
      ),
    ),
  ).toMatchInlineSnapshot(`Error: Predicate $ark.fn19 is not convertible to JSON Schema`)

  expect(
    toJsonSchema(
      type('number').narrow(n => Number.isInteger(n)), //
    ),
  ).toMatchInlineSnapshot(`Error: Predicate $ark.fn20 is not convertible to JSON Schema`)

  expect(
    toJsonSchema(
      // @ts-expect-error .basis isn't in the public typedef
      type('number').narrow(n => Number.isInteger(n)).basis, //
    ),
  ).toMatchInlineSnapshot(`
    {
      "type": "number",
    }
  `)

  expect(
    toJsonSchema(
      type('string').or(
        type('number') // arktype's .toJsonSchema() can't handle types this complex so we end up with json input
          .pipe(n => `Roman numeral: ${'I'.repeat(n)}`),
      ),
    ),
  ).toMatchInlineSnapshot(
    `Error: (In: number) => Out<unknown> is not convertible to JSON Schema because it represents a transformation, while JSON Schema only allows validation. Consider creating a Schema from one of its endpoints using \`.in\` or \`.out\`.`,
  )
  expect(
    toJsonSchema(
      type('string').or(
        type('number') // arktype's .toJsonSchema() can't handle types this complex so we end up with json input
          .pipe(n => `Roman numeral: ${'I'.repeat(n)}`),
      ).in,
    ),
  ).toMatchInlineSnapshot(
    `
      {
        "anyOf": [
          {
            "type": "number",
          },
          {
            "type": "string",
          },
        ],
      }
    `,
  )

  expect(toJsonSchema(type({foo: 'string = "hi"'}))).toMatchInlineSnapshot(`
    {
      "properties": {
        "foo": {
          "type": "string",
        },
      },
      "type": "object",
    }
  `)

  expect(toJsonSchema(type({foo: type('string').default('hi')}))).toMatchInlineSnapshot(`
    {
      "properties": {
        "foo": {
          "type": "string",
        },
      },
      "type": "object",
    }
  `)

  expect(toJsonSchema(type(/foo.*bar/))).toMatchInlineSnapshot(`
    {
      "pattern": "foo.*bar",
      "type": "string",
    }
  `)

  expect(toJsonSchema(type('string').describe('a piece of text'))).toMatchInlineSnapshot(`
    {
      "description": "a piece of text",
      "type": "string",
    }
  `)
})
