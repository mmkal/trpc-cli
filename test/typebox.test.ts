import {initTRPC} from 'trpcserver11'
import Type from 'typebox'
import {expect, test} from 'vitest'
import {TrpcCliMeta} from '../src/index.js'
import {StandardSchemaV1, standardSchema} from '../src/typebox.js'
import {run, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.meta<TrpcCliMeta>().create()

test('merging input types', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Object({bar: Type.String()})))
      .input(standardSchema(Type.Object({baz: Type.Number()})))
      .input(standardSchema(Type.Object({qux: Type.Boolean()})))
      .query(({input}) => JSON.stringify({bar: input.bar, baz: input.baz, qux: input.qux})),
  })

  expect(await run(router, ['foo', '--bar', 'hello', '--baz', '42', '--qux'])).toMatchInlineSnapshot(
    `"{"bar":"hello","baz":42,"qux":true}"`,
  )
})

test('string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(StandardSchemaV1(Type.String())) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'hello'])).toMatchInlineSnapshot(`""hello""`)
})

test('enum input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Union([Type.Literal('aa'), Type.Literal('bb')]))) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'aa'])).toMatchInlineSnapshot(`""aa""`)
  await expect(run(router, ['foo', 'cc'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ must be equal to constant
    ✖ must be equal to constant
    ✖ must match a schema in anyOf
  `)
})

test('number input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Number())) //
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
      .input(standardSchema(Type.Boolean())) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'true'])).toMatchInlineSnapshot(`"true"`)
  expect(await run(router, ['foo', 'false'])).toMatchInlineSnapshot(`"false"`)
  await expect(run(router, ['foo', 'a'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ must be boolean
  `)
})

test('literal input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Literal(2))) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '2'])).toMatchInlineSnapshot(`"2"`)
  await expect(run(router, ['foo', '3'])).rejects.toMatchInlineSnapshot(`
    CLI exited with code 1
      Caused by: CliValidationError: ✖ must be equal to constant
  `)
})

test('optional input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Union([Type.String(), Type.Undefined()]))) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"null"`)
})

test('union input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Union([Type.Number(), Type.String()]))) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"1"`)
})

test('array input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Array(Type.String()))) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'src/index.ts', 'README.md'])).toMatchInlineSnapshot(
    `"["src/index.ts","README.md"]"`,
  )
})

test('tuple input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(standardSchema(Type.Tuple([Type.String(), Type.Number()]))) //
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
        standardSchema(
          Type.Tuple([
            Type.String(),
            Type.Number(),
            Type.Object({foo: Type.String()}), //
          ]),
        ),
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

test('object options', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        standardSchema(
          Type.Object({
            userId: Type.Number(),
            name: Type.String(),
            admin: Type.Optional(Type.Boolean()),
          }),
        ),
      )
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', '--user-id', '123', '--name', 'bob'])).toMatchInlineSnapshot(
    `"{"userId":123,"name":"bob"}"`,
  )
  expect(await run(router, ['foo', '--user-id', '123', '--name', 'bob', '--admin'])).toMatchInlineSnapshot(
    `"{"userId":123,"name":"bob","admin":true}"`,
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
