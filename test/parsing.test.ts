import {Router, initTRPC} from '@trpc/server'
import stripAnsi from 'strip-ansi'
import {expect, test} from 'vitest'
import {z} from 'zod'
import {createCli, TrpcCliMeta, TrpcCliParams} from '../src'

expect.addSnapshotSerializer({
  test: (val): val is Error => val instanceof Error,
  print: val => {
    let err = val as Error
    const messages = [err.message]
    while (err.cause instanceof Error) {
      err = err.cause
      messages.push('  '.repeat(messages.length) + 'Caused by: ' + err.message)
    }
    return stripAnsi(messages.join('\n'))
  },
})

const t = initTRPC.meta<TrpcCliMeta>().create()

const run = <R extends Router<any>>(router: R, argv: string[]) => {
  return runWith({router}, argv)
}
const runWith = <R extends Router<any>>(params: TrpcCliParams<R>, argv: string[]) => {
  const cli = createCli(params)
  return new Promise<string>((resolve, reject) => {
    const logs: unknown[][] = []
    const addLogs = (...args: unknown[]) => logs.push(args)
    void cli
      .run({
        argv,
        logger: {info: addLogs, error: addLogs},
        process: {
          exit: code => {
            if (code === 0) {
              resolve(logs.join('\n'))
            } else {
              reject(
                new Error(`CLI exited with code ${code}`, {
                  cause: new Error('Logs: ' + logs.join('\n')),
                }),
              )
            }
            return code as never
          },
        },
      })
      .catch(reject)
  })
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
      Caused by: Logs: Validation error
      - Invalid enum value. Expected 'aa' | 'bb', received 'cc'
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
      Caused by: Logs: Validation error
      - Expected number, received string
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
      Caused by: Logs: Validation error
      - Expected boolean, received string
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
      Caused by: Logs: Validation error
      - Invalid literal value, expected 2
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
      Caused by: Logs: Validation error
      - Invalid
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
      Caused by: Logs: Validation error
      - Expected number, received string at index 1
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
      Caused by: Logs: Validation error
      - Required at "[2].foo"
  `)
  await expect(run(router, ['foo', 'hello', 'not a number!', '--foo', 'bar'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: Logs: Validation error
      - Expected number, received string at index 1
  `)
  await expect(run(router, ['foo', 'hello', 'not a number!'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: Logs: Validation error
      - Expected number, received string at index 1
      - Required at "[2].foo"
  `)
})

test('single character flag', async () => {
  const router = t.router({
    foo: t.procedure.input(z.object({a: z.string()})).query(({input}) => JSON.stringify(input || null)),
  })

  // todo: support this somehow, not sure why this restriction exists. it comes from type-flag.
  await expect(run(router, ['foo', 'hello', '123', '--a', 'b'])).rejects.toMatchInlineSnapshot(
    `Flag name "a" must be longer than a character`,
  )
})

test('custom default procedure', async () => {
  const yarn = t.router({
    install: t.procedure
      .input(z.object({frozenLockfile: z.boolean().optional()}))
      .query(({input}) => 'install: ' + JSON.stringify(input)),
  })

  const params: TrpcCliParams<typeof yarn> = {
    router: yarn,
    default: {procedure: 'install'},
  }

  const yarnOutput = await runWith(params, ['--frozen-lockfile'])
  expect(yarnOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)

  const yarnInstallOutput = await runWith(params, ['install', '--frozen-lockfile'])
  expect(yarnInstallOutput).toMatchInlineSnapshot(`"install: {"frozenLockfile":true}"`)
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

  expect(cli.ignoredProcedures).toMatchInlineSnapshot(`
    [
      {
        "procedure": "tupleWithObjectInTheMiddle",
        "reason": "Invalid input type [ZodString, ZodObject, ZodString]. Positional parameters must be strings or numbers.",
      },
      {
        "procedure": "tupleWithRecord",
        "reason": "Invalid input type [ZodString, ZodRecord]. The last type must accept object inputs.",
      },
    ]
  `)
})
