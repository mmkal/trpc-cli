import {initTRPC} from '@trpc/server'
import {inspect} from 'util'
import {expect, test} from 'vitest'
import {z} from 'zod'
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

const run = <R extends AnyRouter>(router: R, argv: string[], {expectJsonInput = false} = {}) => {
  return runWith({router}, argv, {expectJsonInput})
}
const runWith = async <R extends AnyRouter>(
  params: TrpcCliParams<R>,
  argv: string[],
  {expectJsonInput = false} = {},
): Promise<string> => {
  const cli = createCli(params)
  const logs = [] as unknown[][]
  const addLogs = (...args: unknown[]) => logs.push(args)
  const result: string = await cli
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

  const hasJsonInput = result.includes('--input [json]')
  if (result.includes('--') && hasJsonInput !== expectJsonInput) {
    throw new Error(`${hasJsonInput ? 'Got' : 'Did not get'} --input [json]:\n\n${result}`)
  }
  return result
}

test('merging input types', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.object({bar: z.string()}))
      .input(z.object({baz: z.number()}))
      .input(z.object({qux: z.boolean()}))
      .query(({input}) => Object.entries(input).join(', ')),
  })

  expect(await run(router, ['foo', '--bar', 'hello', '--baz', '42', '--qux'])).toMatchInlineSnapshot(
    `"bar,hello, baz,42, qux,true"`,
  )
})

test('string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.string()) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'hello'])).toMatchInlineSnapshot(`""hello""`)
})

test('enum input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.enum(['aa', 'bb'])) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'aa'])).toMatchInlineSnapshot(`""aa""`)
  await expect(run(router, ['foo', 'cc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid enum value. Expected 'aa' | 'bb', received 'cc'
  `)
})

test('number input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.number()) //
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
      .input(z.boolean()) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'true'])).toMatchInlineSnapshot(`"true"`)
  expect(await run(router, ['foo', 'false'])).toMatchInlineSnapshot(`"false"`)
  await expect(run(router, ['foo', 'a'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Expected boolean, received string
  `)
})

test('refine in a union pedantry', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.union([z.number().int(), z.string()])) //
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
        z.union([
          z
            .number()
            .int()
            .transform(n => `Roman numeral: ${'I'.repeat(n)}`),
          z.string(),
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
      .input(z.literal(2)) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '2'])).toMatchInlineSnapshot(`"2"`)
  await expect(run(router, ['foo', '3'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid literal value, expected 2
  `)
})

test('optional input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.string().optional()) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"null"`)
})

test('union input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.union([z.number(), z.string()])) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"1"`)
})

test('regex input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.string().regex(/hello/).describe('greeting')) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'hello abc'])).toMatchInlineSnapshot(`""hello abc""`)
  // todo: raise a zod-validation-error issue 👇 not a great error message
  await expect(run(router, ['foo', 'goodbye xyz'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Invalid
  `)
})

test('boolean, number, string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        z.union([
          z.string(),
          z.number(),
          z.boolean(), //
        ]),
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
      .input(z.tuple([z.string(), z.number()])) //
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
        z.tuple([
          z.string(),
          z.number(),
          z.object({foo: z.string()}), //
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
      .input(z.object({a: z.string()})) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
  await expect(run(router, ['foo', '--a', 'b'])).resolves.toEqual(`{"a":"b"}`)
})

test('custom default procedure', async () => {
  const router = t.router({
    install: t.procedure
      .meta({default: true})
      .input(z.object({cwd: z.string()})) // let's pretend cwd is a required option
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
      .input(z.object({frozenLockfile: z.boolean().optional()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['i', '--frozen-lockfile'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'x'}}})
      .input(z.object({frozenLockfile: z.boolean().optional()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['install', '-x'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias can be two characters', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frozenLockfile: 'xx'}}})
      .input(z.object({frozenLockfile: z.boolean().optional()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const yarnIOutput = await run(router, ['install', '--xx'])
  expect(yarnIOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
})

test('option alias typo', async () => {
  const router = t.router({
    install: t.procedure
      .meta({aliases: {options: {frooozenLockfile: 'x'}}})
      .input(z.object({frozenLockfile: z.boolean().optional()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  await expect(run(router, ['install', '-x'])).rejects.toMatchInlineSnapshot(
    `Error: Invalid option aliases: frooozenLockfile: x`,
  )
})

test('validation', async () => {
  const router = t.router({
    tupleOfStrings: t.procedure
      .input(z.tuple([z.string().describe('The first string'), z.string().describe('The second string')]))
      .query(() => 'ok'),
    tupleWithBoolean: t.procedure
      .input(z.tuple([z.string(), z.boolean()])) //
      .query(() => 'ok'),
    tupleWithBooleanThenObject: t.procedure
      .input(z.tuple([z.string(), z.boolean(), z.object({foo: z.string()})]))
      .query(() => 'ok'),
    tupleWithObjectInTheMiddle: t.procedure
      .input(z.tuple([z.string(), z.object({foo: z.string()}), z.string()]))
      .query(() => 'ok'),
    tupleWithRecord: t.procedure
      .input(z.tuple([z.string(), z.record(z.string())])) //
      .query(() => 'ok'),
  })
  const cli = createCli({router})
  expect(cli).toBeDefined()
})

test('string array input', async () => {
  const router = t.router({
    stringArray: t.procedure
      .input(z.array(z.string())) //
      .query(({input}) => `strings: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['string-array', 'hello', 'world'])
  expect(result).toMatchInlineSnapshot(`"strings: ["hello","world"]"`)
})

test('number array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(z.array(z.number())) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', '1', '2', '3', '4'])
  expect(result).toMatchInlineSnapshot(`"list: [1,2,3,4]"`)

  await expect(run(router, ['test', '1', 'bad'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Expected number, received string → at [1]
  `)
})

test('number array input with constraints', async () => {
  const router = t.router({
    foo: t.procedure
      .input(z.array(z.number().int())) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  await expect(run(router, ['foo', '1.2'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Expected number, received string → at [0]
  `)
})

test('boolean array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(z.array(z.boolean())) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', 'true', 'false', 'true'])
  expect(result).toMatchInlineSnapshot(`"list: [true,false,true]"`)

  await expect(run(router, ['test', 'true', 'bad'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ Expected boolean, received string → at [1]
  `)
})

test('mixed array input', async () => {
  const router = t.router({
    test: t.procedure
      .input(z.array(z.union([z.boolean(), z.number(), z.string()]))) //
      .query(({input}) => `list: ${JSON.stringify(input)}`),
  })

  const result = await run(router, ['test', '12', 'true', '3.14', 'null', 'undefined', 'hello'])
  expect(result).toMatchInlineSnapshot(`"list: [12,true,3.14,"null","undefined","hello"]"`)
})

test('record input', async () => {
  const router = t.router({
    test: t.procedure
      .input(z.record(z.number()).optional()) //
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
      Caused by: CliValidationError: ✖ Expected number, received string → at foo
  `)
})

test("nullable array inputs aren't supported", async () => {
  const router = t.router({
    test1: t.procedure.input(z.array(z.string().nullable())).query(({input}) => `list: ${JSON.stringify(input)}`),
    test2: t.procedure
      .input(z.array(z.union([z.boolean(), z.number(), z.string()]).nullable())) //
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
        z.tuple([
          z.array(z.string()), //
          z.object({foo: z.string()}).optional(),
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
        z.tuple([
          z.array(z.union([z.string(), z.number()])), //
          z.object({foo: z.string().optional()}),
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
    normalBoolean: t.procedure.input(z.object({foo: z.boolean()})).query(({input}) => `${inspect(input)}`),
    optionalBoolean: t.procedure.input(z.object({foo: z.boolean().optional()})).query(({input}) => `${inspect(input)}`),
    defaultTrueBoolean: t.procedure
      .input(z.object({foo: z.boolean().default(true)}))
      .query(({input}) => `${inspect(input)}`),
    defaultFalseBoolean: t.procedure
      .input(z.object({foo: z.boolean().default(false)}))
      .query(({input}) => `${inspect(input)}`),
    booleanOrNumber: t.procedure
      .input(z.object({foo: z.union([z.boolean(), z.number()])}))
      .query(({input}) => `${inspect(input)}`),
    booleanOrString: t.procedure
      .input(z.object({foo: z.union([z.boolean(), z.string()])}))
      .query(({input}) => `${inspect(input)}`),
    arrayOfBooleanOrNumber: t.procedure
      .input(z.object({foo: z.array(z.union([z.boolean(), z.number()]))}))
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
