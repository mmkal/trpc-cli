/* eslint-disable @typescript-eslint/no-shadow */
import * as v from 'valibot'
import {describe, expect, test} from 'vitest'
import {z} from 'zod/v4'
import {os, t} from '../src/index.js'
import {run, snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer({
  test: val => val instanceof z.ZodType,
  print: val => (val as object)?.constructor.name,
})

expect.addSnapshotSerializer(snapshotSerializer)

expect.addSnapshotSerializer({
  test: val => typeof val === 'string',
  serialize: val =>
    `"${val}"`.replaceAll('json-schema.org/draft-2020-12/schema', 'json-schema.org/draft/2020-12/schema'),
})

describe('trpc style', () => {
  const router = t.router({
    hello: t.procedure
      .input(
        z.object({
          foo: z.string(),
          bar: z.number(),
        }),
      )
      .query(({input}) => `hello ${input.foo} ${input.bar}`),
    withValibot: t.procedure
      .input(
        v.object({
          abc: v.string(),
          def: v.number(),
        }),
      )
      .mutation(({input}) => `abc is ${input.abc} and def is ${input.def}`),
    deeply: {
      nested: {
        greeting: t.procedure.input(z.string()).query(({input}) => `hello ${input}`),
      },
    },
  })

  test('basic usage', async () => {
    expect(await run(router, ['hello', '--foo', 'world', '--bar', '42'])).toMatchInlineSnapshot(`"hello world 42"`)
    expect(await run(router, ['with-valibot', '--abc', 'hello', '--def', '42'])).toMatchInlineSnapshot(
      `"abc is hello and def is 42"`,
    )
    expect(await run(router, ['deeply', 'nested', 'greeting', 'hi'])).toMatchInlineSnapshot(`"hello hi"`)
  })

  test('unjsonifiable schema', async () => {
    const router = t.router({
      hello: t.procedure
        .input(
          z.custom<{foo: string; bar: number}>(v => {
            const value = v as Record<string, unknown>
            return typeof value?.foo === 'string' && typeof value.bar === 'number'
          }),
        )
        .mutation(({input}) => `foo is ${input.foo} and bar is ${input.bar}`),
    })

    expect(await run(router, ['hello', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
      "Usage: program hello [options]

      Options:
        --input [json]  Input formatted as JSON (procedure's schema couldn't be
                        converted to CLI arguments: Invalid input type { '$schema':
                        'https://json-schema.org/draft/2020-12/schema' }, expected
                        object or tuple.)
        -h, --help      display help for command
      "
    `)
    expect(await run(router, ['hello', '--input', '{"foo": "world", "bar": 42}'])).toMatchInlineSnapshot(
      `"foo is world and bar is 42"`,
    )
  })

  test('json input via meta', async () => {
    const router = t.router({
      hello: t.procedure
        .meta({jsonInput: true})
        .input(z.object({foo: z.string(), bar: z.number()}))
        .query(({input}) => `foo is ${input.foo} and bar is ${input.bar}`),
    })

    expect(await run(router, ['hello', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
      "Usage: program hello [options]

      Options:
        --input [json]  Input formatted as JSON
        -h, --help      display help for command
      "
    `)
    expect(await run(router, ['hello', '--input', '{"foo": "world", "bar": 42}'])).toMatchInlineSnapshot(
      `"foo is world and bar is 42"`,
    )
  })

  test('middleware with context (trpc style uses ctx)', async () => {
    // Create a reusable procedure with middleware that adds context
    const withUser = t.procedure.use(async ({next}) => {
      return next({
        ctx: {user: {id: 1, name: 'Alice'}},
      })
    })

    const withPermissions = withUser.use(async ({ctx, next}) => {
      return next({
        ctx: {permissions: ctx.user.id === 1 ? ['admin'] : ['guest']},
      })
    })

    const router = t.router({
      whoami: withUser.query(({ctx}) => `I am ${ctx.user.name} (id: ${ctx.user.id})`),
      permissions: withPermissions.query(
        ({ctx}) => `User ${ctx.user.name} has permissions: ${ctx.permissions.join(', ')}`,
      ),
      greet: withUser
        .input(z.object({greeting: z.string()}))
        .mutation(({input, ctx}) => `${input.greeting}, ${ctx.user.name}!`),
    })

    expect(await run(router, ['whoami'])).toMatchInlineSnapshot(`"I am Alice (id: 1)"`)
    expect(await run(router, ['permissions'])).toMatchInlineSnapshot(`"User Alice has permissions: admin"`)
    expect(await run(router, ['greet', '--greeting', 'Hello'])).toMatchInlineSnapshot(`"Hello, Alice!"`)
  })
})

describe('orpc style', () => {
  const router = os.router({
    hello: os
      .input(
        z.object({
          foo: z.string(),
          bar: z.number(),
        }),
      )
      .handler(({input}) => `hello ${input.foo} ${input.bar}`),
    withValibot: os
      .input(
        v.object({
          abc: v.string(),
          def: v.number(),
        }),
      )
      .handler(({input}) => `abc is ${input.abc} and def is ${input.def}`),
    deeply: {
      nested: {
        greeting: os.input(z.string()).handler(({input}) => `hello ${input}`),
      },
    },
  })

  test('basic usage', async () => {
    expect(await run(router, ['hello', '--foo', 'world', '--bar', '42'])).toMatchInlineSnapshot(`"hello world 42"`)
    expect(await run(router, ['with-valibot', '--abc', 'hello', '--def', '42'])).toMatchInlineSnapshot(
      `"abc is hello and def is 42"`,
    )
    expect(await run(router, ['deeply', 'nested', 'greeting', 'hi'])).toMatchInlineSnapshot(`"hello hi"`)
  })

  test('unjsonifiable schema', async () => {
    const router = os.router({
      hello: os
        .input(
          z.custom<{foo: string; bar: number}>(v => {
            const value = v as Record<string, unknown>
            return typeof value?.foo === 'string' && typeof value.bar === 'number'
          }),
        )
        .handler(({input}) => `foo is ${input.foo} and bar is ${input.bar}`),
    })

    expect(await run(router, ['hello', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
      "Usage: program hello [options]

      Options:
        --input [json]  Input formatted as JSON (procedure's schema couldn't be
                        converted to CLI arguments: Invalid input type { '$schema':
                        'https://json-schema.org/draft/2020-12/schema' }, expected
                        object or tuple.)
        -h, --help      display help for command
      "
    `)
    expect(await run(router, ['hello', '--input', '{"foo": "world", "bar": 42}'])).toMatchInlineSnapshot(
      `"foo is world and bar is 42"`,
    )
  })

  test('json input via meta', async () => {
    const router = os.router({
      hello: os
        .meta({jsonInput: true})
        .input(z.object({foo: z.string(), bar: z.number()}))
        .handler(({input}) => `foo is ${input.foo} and bar is ${input.bar}`),
    })

    expect(await run(router, ['hello', '--help'], {expectJsonInput: true})).toMatchInlineSnapshot(`
      "Usage: program hello [options]

      Options:
        --input [json]  Input formatted as JSON
        -h, --help      display help for command
      "
    `)
    expect(await run(router, ['hello', '--input', '{"foo": "world", "bar": 42}'])).toMatchInlineSnapshot(
      `"foo is world and bar is 42"`,
    )
  })

  test('middleware with context (orpc style uses context)', async () => {
    // Create a reusable procedure with middleware that adds context
    // oRPC uses `context` instead of `ctx`
    const withUser = os.use(async ({next}) => {
      return next({
        context: {user: {id: 1, name: 'Bob'}},
      })
    })

    const withPermissions = withUser.use(async ({context, next}) => {
      return next({
        context: {permissions: context.user.id === 1 ? ['admin'] : ['guest']},
      })
    })

    const router = os.router({
      whoami: withUser.handler(({context}) => `I am ${context.user.name} (id: ${context.user.id})`),
      permissions: withPermissions.handler(
        ({context}) => `User ${context.user.name} has permissions: ${context.permissions.join(', ')}`,
      ),
      greet: withUser
        .input(z.object({greeting: z.string()}))
        .handler(({input, context}) => `${input.greeting}, ${context.user.name}!`),
    })

    expect(await run(router, ['whoami'])).toMatchInlineSnapshot(`"I am Bob (id: 1)"`)
    expect(await run(router, ['permissions'])).toMatchInlineSnapshot(`"User Bob has permissions: admin"`)
    expect(await run(router, ['greet', '--greeting', 'Hi'])).toMatchInlineSnapshot(`"Hi, Bob!"`)
  })
})
