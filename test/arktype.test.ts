/* eslint-disable vitest/expect-expect */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {type} from 'arktype'
import {initTRPC} from 'trpcserver11'
import {inspect} from 'util'
import {expect, test} from 'vitest'
import {AnyRouter, createCli, TrpcCliMeta, TrpcCliParams} from '../src'
import {looksLikeInstanceof} from '../src/util'
import {run, runWith, snapshotSerializer} from './test-run'

expect.addSnapshotSerializer(snapshotSerializer)

// expect.addSnapshotSerializer({
//   test: val => typeof val === 'string' && /\$ark\.fn\d+\b/.test(val),
//   serialize(val) {
//     return val.replaceAll(/\$ark\.fn\d+\b/g, '$ark.fn...')
//   },
// })

// expect.addSnapshotSerializer({
//   test: val => looksLikeInstanceof(val, Error),
//   serialize(val, config, indentation, depth, refs, printer) {
//     let topLine = `${val.constructor.name}: ${val.message}`
//     if (val.constructor.name === 'FailedToExitError') topLine = `CLI exited with code ${val.exitCode}`

//     if (!val.cause) return topLine
//     indentation += '  '
//     return `${topLine}\n${indentation}Caused by: ${printer(val.cause, config, indentation, depth + 1, refs)}`
//       .split(/(---|Usage:)/)[0] // strip out the usage line and the --- line which is added for debugging when tests fail
//       .trim()
//   },
// })

const t = initTRPC.meta<TrpcCliMeta>().create()

// const run = <R extends AnyRouter>(router: R, argv: string[]) => {
//   return runWith({router}, argv)
// }
// const runWith = <R extends AnyRouter>(params: TrpcCliParams<R>, argv: string[]) => {
//   const cli = createCli({trpcServer: import('trpcserver11'), ...params})
//   const logs = [] as unknown[][]
//   const addLogs = (...args: unknown[]) => logs.push(args)
//   return cli
//     .run({
//       argv,
//       logger: {info: addLogs, error: addLogs},
//       process: {exit: _ => 0 as never},
//     })
//     .catch(e => {
//       if (e.exitCode === 0 && e.cause.message === '(outputHelp)') return logs[0][0] // should be the help text
//       if (e.exitCode === 0) return e.cause
//       throw e
//     })
// }

// codegen:start {preset: custom, source: ./validation-library-codegen.ts, export: testSuite}
// NOTE: the below tests are ✨generated✨ based on the hand-written tests in ../zod3.test.ts
// But the zod types are expected to be replaced with equivalent types (written by hand).
// If you change anything other than `.input(...)` types, the linter will just undo your changes.

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
      ) //
      .query(({input}) => JSON.stringify(input)),
  })

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
  // todo: raise a zod-validation-error issue 👇 not a great error message
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
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: command-argument value 'not a number!' is invalid for argument 'parameter_2'. Invalid number: not a number!
  `)
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
      .input(type({a: 'string'})) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
})

test('custom default procedure', async () => {
  const router = t.router({
    install: t.procedure
      .meta({default: true})
      .input(type({cwd: 'string'})) // let's pretend cwd is a required option
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
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['i', '--frozen-lockfile'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'x'}}})
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['install', '-x'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias can be two characters', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'xx'}}})
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['install', '--xx'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias typo', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frooozenLockfile: 'x'}}})
      .input(type({frozenLockfile: 'boolean'}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  await expect(run(router, ['install', '-x'])).rejects.toMatchInlineSnapshot(
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

  const result = await run(router, ['string-array', 'hello', 'world'])
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
      .input(type('number[]').narrow(ns => ns.every(n => Number.isInteger(n)))) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  await expect(run(router, ['foo', '1.2'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: must be valid according to an anonymous predicate (was [1.2])
  `)
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

test('record input', async () => {
  const router = t.router({
    test: t.procedure
      .input(type({'[string]': 'number'})) //
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
  // expect(await run(router, ['test'])).toMatchInlineSnapshot(`"input: undefined"`)
  expect(await run(router, ['test', '--input', '{"foo": 1}'])).toMatchInlineSnapshot(`"input: {"foo":1}"`)
  await expect(run(router, ['test', '--input', '{"foo": "x"}'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: foo must be a number (was a string)
  `)
})

test("nullable array inputs aren't supported", async () => {
  const router = t.router({
    test1: t.procedure.input(type('(string | null)[]')).query(({input}) => `list: ${JSON.stringify(input)}`),
    test2: t.procedure
      .input(type('(boolean | number | string | null)[]')) //
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

  expect(await run(router, ['normal-boolean'])).toMatchInlineSnapshot(`"{ foo: false }"`)
  expect(await run(router, ['normal-boolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)

  expect(await run(router, ['optional-boolean'])).toMatchInlineSnapshot(`"{}"`)
  expect(await run(router, ['optional-boolean', '--foo'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optional-boolean', '--foo', 'true'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['optional-boolean', '--foo', 'false'])).toMatchInlineSnapshot(`"{ foo: false }"`)

  expect(await run(router, ['default-true-boolean'])).toMatchInlineSnapshot(`"{ foo: true }"`)
  expect(await run(router, ['default-true-boolean', '--no-foo'])).toMatchInlineSnapshot(`"{ foo: false }"`)

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
  ).toMatchInlineSnapshot(`
    ToJsonSchemaError: {
        code: "predicate",
        base: {
            type: "number"
        },
        predicate: Function(fn16)
    }
  `)

  expect(
    toJsonSchema(
      type('number').narrow(n => Number.isInteger(n)), //
    ),
  ).toMatchInlineSnapshot(`
    ToJsonSchemaError: {
        code: "predicate",
        base: {
            type: "number"
        },
        predicate: Function(fn17)
    }
  `)

  expect(
    toJsonSchema(
      // @ts-expect-error .basis isn't in the public typedef
      type('number').narrow(n => Number.isInteger(n)).basis, //
    ),
  ).toMatchInlineSnapshot(`
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    `
      ToJsonSchemaError: {
          code: "morph",
          base: {
              type: "number"
          },
          out: null
      }
    `,
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
        "$schema": "https://json-schema.org/draft/2020-12/schema",
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
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "foo": {
          "default": "hi",
          "type": "string",
        },
      },
      "type": "object",
    }
  `)

  expect(toJsonSchema(type({foo: type('string').default('hi')}))).toMatchInlineSnapshot(`
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "foo": {
          "default": "hi",
          "type": "string",
        },
      },
      "type": "object",
    }
  `)

  expect(toJsonSchema(type(/foo.*bar/))).toMatchInlineSnapshot(`
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "pattern": "foo.*bar",
      "type": "string",
    }
  `)

  expect(toJsonSchema(type('string').describe('a piece of text'))).toMatchInlineSnapshot(`
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "description": "a piece of text",
      "type": "string",
    }
  `)
})
