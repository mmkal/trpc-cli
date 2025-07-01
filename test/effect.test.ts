import {Schema} from 'effect'
import {initTRPC} from 'trpcserver11'
import {expect, test} from 'vitest'
import {TrpcCliMeta} from '../src'
import {run, snapshotSerializer} from './test-run'

expect.addSnapshotSerializer(snapshotSerializer)

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
      Caused by: CommanderError: error: command-argument value 'abc' is invalid for argument 'number'. Invalid number: abc
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
      Caused by: CliValidationError: ✖ Expected "aa", actual "cc"
    ✖ Expected "bb", actual "cc"
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
