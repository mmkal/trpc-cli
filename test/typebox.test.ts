import {initTRPC} from 'trpcserver11'
import {expect, expectTypeOf, test} from 'vitest'
import {TrpcCliMeta} from '../src/index.js'
import Type, {Script, type Static} from '../src/typebox/index.js'
import {run, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

const t = initTRPC.meta<TrpcCliMeta>().create()

test('script with jsdoc comments', async () => {
  const Input = Type.Script(`
    {
      /** a message to say hello to new users */
      greeting: string
      /**
       * how many times to repeat the
       * greeting
       */
      repeat?: number
    }
  `)

  expect(Input).toMatchObject({
    type: 'object',
    required: ['greeting'],
    properties: {
      greeting: {type: 'string', description: 'a message to say hello to new users'},
      repeat: {type: 'number', description: 'how many times to repeat the\ngreeting'},
    },
  })

  // static inference is unaffected by the comments
  expectTypeOf<Static<typeof Input>>().toEqualTypeOf<{greeting: string; repeat?: number}>()

  const router = t.router({
    hello: t.procedure.input(Input).query(({input}) => `${input.greeting}!`.repeat(input.repeat ?? 1)),
  })

  // jsdoc comments end up in --help output
  expect(await run(router, ['hello', '--help'])).toContain('a message to say hello to new users')

  expect(await run(router, ['hello', '--greeting', 'hi', '--repeat', '2'])).toMatchInlineSnapshot(`"hi!hi!"`)
})

test('jsdoc on nested properties', () => {
  const Input = Script(`
    {
      /** outer doc */
      config: {
        /** inner doc */
        verbose: boolean
      }
    }
  `)

  expect(Input).toMatchObject({
    properties: {
      config: {
        description: 'outer doc',
        properties: {verbose: {type: 'boolean', description: 'inner doc'}},
      },
    },
  })
})

test('jsdoc-like text inside string literal types is not treated as a comment', () => {
  const Input = Script(`
    {
      weird: '/** not a doc */',
      real: string
    }
  `)

  expect(Input.properties.weird).toMatchObject({const: '/** not a doc */'})
  expect(Input.properties.real).not.toHaveProperty('description')
})

test("// line comments don't attach as descriptions", () => {
  // known limitation of the jsdoc patch: only `/** ... */` jsdoc comments become descriptions.
  // `//` line comments are treated as trivia, same as upstream.
  const Input = Script(`
    {
      // this is a regular comment, not a jsdoc
      name: string
    }
  `)

  expect(Input.properties.name).toMatchObject({type: 'string'})
  expect(Input.properties.name).not.toHaveProperty('description')
})

test('~standard validate', () => {
  const Person = Type.Object({name: Type.String(), age: Type.Number()})

  expect(Person['~standard'].vendor).toBe('typebox')
  expect(Person['~standard'].version).toBe(1)

  const ok = Person['~standard'].validate({name: 'bob', age: 42})
  expect(ok).toMatchObject({value: {name: 'bob', age: 42}})

  const bad = Person['~standard'].validate({name: 'bob', age: 'not a number'})
  expect(bad).toMatchObject({issues: [{path: ['age'], message: expect.stringContaining('number')}]})
})

test('~standard jsonSchema converter', () => {
  const Person = Type.Object({name: Type.String()})
  expect(Person['~standard'].jsonSchema.input({target: 'draft-07'})).toMatchObject({
    type: 'object',
    required: ['name'],
    properties: {name: {type: 'string'}},
  })
})

test('~standard does not pollute serialization', () => {
  const Person = Type.Object({name: Type.String()})
  const serialized = JSON.stringify(Person) // JSON round-trip is the point here - schemas should serialize as clean JSON Schema
  expect(JSON.parse(serialized)).toEqual({
    type: 'object',
    required: ['name'],
    properties: {name: {type: 'string'}},
  })
  expect(Object.keys(Person)).not.toContain('~standard')
})

test('merging input types', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Type.Object({bar: Type.String()}))
      .input(Type.Object({baz: Type.Number()}))
      .input(Type.Object({qux: Type.Boolean()}))
      .query(({input}) => JSON.stringify({bar: input.bar, baz: input.baz, qux: input.qux})),
  })

  expect(await run(router, ['foo', '--bar', 'hello', '--baz', '42', '--qux'])).toMatchInlineSnapshot(
    `"{"bar":"hello","baz":42,"qux":true}"`,
  )
})

test('string input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Type.String()) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'hello'])).toMatchInlineSnapshot(`""hello""`)
})

test('enum input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Type.Union([Type.Literal('aa'), Type.Literal('bb')])) //
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
      .input(Type.Number()) //
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
      .input(Type.Boolean()) //
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
      .input(Type.Literal(2)) //
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
      .input(Type.Union([Type.String(), Type.Undefined()])) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo'])).toMatchInlineSnapshot(`"null"`)
})

test('union input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Type.Union([Type.Number(), Type.String()])) //
      .query(({input}) => JSON.stringify(input || null)),
  })

  expect(await run(router, ['foo', 'a'])).toMatchInlineSnapshot(`""a""`)
  expect(await run(router, ['foo', '1'])).toMatchInlineSnapshot(`"1"`)
})

test('array input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Type.Array(Type.String())) //
      .query(({input}) => JSON.stringify(input)),
  })

  expect(await run(router, ['foo', 'src/index.ts', 'README.md'])).toMatchInlineSnapshot(
    `"["src/index.ts","README.md"]"`,
  )
})

test('tuple input', async () => {
  const router = t.router({
    foo: t.procedure
      .input(Type.Tuple([Type.String(), Type.Number()])) //
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
        Type.Tuple([
          Type.String(),
          Type.Number(),
          Type.Object({foo: Type.String()}), //
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
})

test('object options', async () => {
  const router = t.router({
    foo: t.procedure
      .input(
        Type.Object({
          userId: Type.Number(),
          name: Type.String(),
          admin: Type.Optional(Type.Boolean()),
        }),
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
})

test('script tuple input', async () => {
  const router = t.router({
    add: t.procedure
      .input(Script('[number, number]')) //
      .query(({input}) => input[0] + input[1]),
  })

  expect(await run(router, ['add', '2', '3'])).toMatchInlineSnapshot(`"5"`)
})

test('static inference flows into procedures', () => {
  const Input = Type.Object({name: Type.String(), count: Type.Optional(Type.Number())})
  expectTypeOf<Static<typeof Input>>().toEqualTypeOf<{name: string; count?: number}>()

  t.router({
    foo: t.procedure.input(Input).query(({input}) => {
      expectTypeOf(input.name).toEqualTypeOf<string>()
      expectTypeOf(input.count).toEqualTypeOf<number | undefined>()
      return null
    }),
  })
})
