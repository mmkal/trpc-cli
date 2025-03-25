import {Schema} from 'effect'
import {initTRPC} from 'trpcserver11'
import {expect, test} from 'vitest'
import {AnyRouter, createCli, TrpcCliMeta, TrpcCliParams} from '../src'
import {looksLikeInstanceof} from '../src/util'

const t = initTRPC.meta<TrpcCliMeta>().create()

test('string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Schema.standardSchemaV1(Schema.String)) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'hello'])).toMatchInlineSnapshot(`""hello""`)
})

test('number input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Schema.standardSchemaV1(Schema.Number)) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '123'])).toMatchInlineSnapshot(`"123"`)
  await expect(run(router, ['foo', 'abc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Expected number, actual "abc"
  `)
})

test('enum input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Schema.standardSchemaV1(Schema.Union(Schema.Literal('aa'), Schema.Literal('bb')))) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'aa'])).toMatchInlineSnapshot(`""aa""`)
  await expect(run(router, ['foo', 'cc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: Expected "aa", actual "cc"
  `)
})

test('options', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        Schema.standardSchemaV1(
          Schema.Struct({
            userId: Schema.Number,
            name: Schema.String,
          }),
        ),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '--user-id', '123', '--name', 'bob'])).toMatchInlineSnapshot(
    `"{"userId":123,"name":"bob"}"`,
  )
  await expect(run(router, ['foo', '--name', 'bob'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: required option '--user-id <number>' not specified
  `)
  await expect(run(router, ['foo', '--user-id', '123'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CommanderError: error: required option '--name <string>' not specified
  `)
})

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
