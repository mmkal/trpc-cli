import {initTRPC as initTRPC_v10} from 'trpcserver10'
import {initTRPC as initTRPC_v11} from 'trpcserver11'
import * as v from 'valibot'
import {expect, expectTypeOf, test} from 'vitest'
import {z} from 'zod/v3'
import {createCli, TrpcCliMeta, TrpcServerModuleLike} from '../src'
import {isOrpcRouter, Trpc10RouterLike, Trpc11RouterLike} from '../src/trpc-compat'

expect.addSnapshotSerializer({
  test: val => val?.cause && val.message,
  serialize(val, config, indentation, depth, refs, printer) {
    indentation += '  '
    return `[${val.constructor.name}: ${val.message}]\n${indentation}Caused by: ${printer(val.cause, config, indentation, depth + 1, refs)}`
  },
})

test('trpc v10 shape check', async () => {
  expectTypeOf(await import('trpcserver10')).toExtend<TrpcServerModuleLike>()

  const t = initTRPC_v10.context<{customContext: true}>().meta<TrpcCliMeta>().create()

  const router = t.router({
    add: t.procedure
      .input(z.tuple([z.number(), z.number()])) //
      .mutation(({input}) => {
        return input[0] + input[1]
      }),
    foo: t.router({
      bar: t.procedure.query(() => 'baz'),
    }),
    deeply: t.router({
      nested1: t.router({
        command1: t.procedure.query(() => 'ok'),
      }),
    }),
  }) satisfies Trpc10RouterLike // this satisfies makes sure people can write a normal router and they'll be allowed to pass it in

  expect(router._def.procedures).toHaveProperty('foo.bar')
  expect(router._def.procedures).not.toHaveProperty('foo')

  expectTypeOf(router).toExtend<Trpc10RouterLike>()

  expect(router._def.procedures.add._def.mutation).toBe(true)
  expect(router._def.procedures.add._def.query).toBeUndefined()
  expect(router._def.procedures.add._def.subscription).toBeUndefined()
  // at some point maybe _type was defined? It was in this codebase, just test that it's undefined explicitly
  expect((router._def.procedures.add._def as any).type).toBeUndefined()
  expect((router._def.procedures.add._def as any)._type).toBeUndefined()

  if (Math.random() > 10) {
    // just some satisfies statements to help build type types in src/trpc-compat.ts
    router._def._config.$types satisfies {ctx: {customContext: true}; meta: TrpcCliMeta}
    router._def.procedures.add._type satisfies 'mutation'
    router._def.procedures.add._def.inputs satisfies unknown[]
    router._def.procedures.add._def._input_in satisfies [number, number]
    router._def.procedures.add._def._output_out satisfies number
  }
})

test('trpc v11 shape check', async () => {
  expectTypeOf(await import('trpcserver11')).toExtend<TrpcServerModuleLike>()

  const t = initTRPC_v11.context<{customContext: true}>().meta<TrpcCliMeta>().create()

  const trpc = t
  const router = t.router({
    add: t.procedure
      .meta({description: 'Add two numbers'})
      .input(z.tuple([z.number(), z.number()])) //
      .mutation(({input}) => {
        return input[0] + input[1]
      }),
    foo: {
      bar: t.procedure.query(() => 'baz'),
    },
    abc: t.router({
      def: t.procedure.query(() => 'baz'),
    }),
    deeply: trpc.router({
      nested2: trpc.router({
        command3: trpc.procedure.input(z.object({foo3: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
        command4: trpc.procedure.input(z.object({foo4: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
      }),
    }),
  }) satisfies Trpc11RouterLike // this satisfies makes sure people can write a normal router and they'll be allowed to pass it in

  expect(router._def.procedures).toHaveProperty('foo.bar')
  expect(router._def.procedures).not.toHaveProperty('foo')
  expect(router._def.procedures).toHaveProperty('abc.def')
  expect(router._def.procedures).not.toHaveProperty('abc')

  // @ts-expect-error for some reason trpc11 doesn't expose `.inputs` at the type level
  expect(router._def.procedures.add._def.inputs).toEqual([expect.any(z.ZodType)])
  expect(router._def.procedures.add._def.meta).toEqual({description: 'Add two numbers'})
  expect((router._def.procedures.add as any).meta).toBeUndefined() // for some reason we were trying to access meta on the procedure itself at one point

  expect((router._def.procedures.add._def as any).mutation).toBeUndefined()
  expect((router._def.procedures.add._def as any).query).toBeUndefined()
  expect((router._def.procedures.add._def as any).subscription).toBeUndefined()
  expect((router._def.procedures.add._def as any).type).toBe('mutation')
  // at some point maybe _type was defined? It was in this codebase, just test that it's undefined explicitly
  expect((router._def.procedures.add._def as any)._type).toBeUndefined()
  if (Math.random() > 10) {
    // just some satisfies statements to help build type types in src/trpc-compat.ts
    router._def.procedures.add._def.type satisfies 'mutation'
    router._def._config.$types satisfies {ctx: {customContext: true}; meta: TrpcCliMeta}
    router._def.procedures.add._def.$types.input satisfies [number, number]
    router._def.procedures.add._def.$types.output satisfies number
  }
})

test('trpc v11 works without hoop-jumping', async () => {
  const t = initTRPC_v11.context<{customContext: true}>().meta<TrpcCliMeta>().create()

  const router = t.router({
    add: t.procedure
      .meta({description: 'Add two numbers'})
      .input(z.tuple([z.number(), z.number()])) //
      .mutation(({input}) => {
        return input[0] + input[1]
      }),
  }) satisfies Trpc11RouterLike // this satisfies makes sure people can write a normal router and they'll be allowed to pass it in

  const cli = createCli({router})

  const runAndCaptureProcessExit = async ({argv}: {argv: string[]}): Promise<Error | undefined> => {
    return cli
      .run({argv, logger: {info: () => {}, error: () => {}}, process: {exit: () => void 0 as never}})
      .catch(e => e)
  }
  const error = await runAndCaptureProcessExit({argv: ['add', '1', '2']})
  expect(error).toMatchObject({exitCode: 0})
  expect(error?.cause).toBe(3)
})

test('trpc v10 works when passing in trpcServer', async () => {
  const t = initTRPC_v10.context<{customContext: true}>().meta<TrpcCliMeta>().create()

  const router = t.router({
    add: t.procedure
      .meta({description: 'Add two numbers'})
      .input(z.tuple([z.number(), z.number()])) //
      .mutation(({input}) => {
        return input[0] + input[1]
      }),
  })

  const cli = createCli({router, trpcServer: import('trpcserver10')})

  const runAndCaptureProcessExit = async ({argv}: {argv: string[]}): Promise<Error | undefined> => {
    return cli
      .run({argv, logger: {info: () => {}, error: () => {}}, process: {exit: () => void 0 as never}})
      .catch(e => e)
  }
  const error = await runAndCaptureProcessExit({argv: ['add', '1', '2']})
  expect(error).toMatchObject({exitCode: 0})
  expect(error?.cause).toBe(3)
})

test('trpc v10 has helpful error when not passing in trpcServer', async () => {
  const t = initTRPC_v10.context<{customContext: true}>().meta<TrpcCliMeta>().create()

  const router = t.router({
    add: t.procedure
      .meta({description: 'Add two numbers'})
      .input(z.tuple([z.number(), z.number()])) //
      .mutation(({input}) => {
        return input[0] + input[1]
      }),
  })

  const cli = createCli({router})

  const runAndCaptureProcessExit = async ({argv}: {argv: string[]}): Promise<Error | undefined> => {
    return cli
      .run({argv, logger: {info: () => {}, error: () => {}}, process: {exit: () => void 0 as never}})
      .catch(e => e)
  }
  const error = await runAndCaptureProcessExit({argv: ['add', '1', '2']})
  expect(error).toMatchObject({exitCode: 1})
  expect(error?.cause).toMatchInlineSnapshot(
    `[Error: Failed to create trpc caller. If using trpc v10, either upgrade to v11 or pass in the \`@trpc/server\` module to \`createCli\` explicitly]`,
  )
})

test('isOrpcRouter', async () => {
  const {os} = await import('@orpc/server')
  // expect(isOrpcRouter(os.router({}))).toBe(true) // fails, because we only now how to look for procedures really
  expect(isOrpcRouter(os.router({hello: os.handler(() => 'ok')}))).toBe(true)
  expect(isOrpcRouter(os.router({hello: os.router({nested: os.handler(() => 'ok')})}))).toBe(true)
  expect(isOrpcRouter({hello: {nested: os.handler(() => 'ok')}})).toBe(true)

  const {initTRPC} = await import('trpcserver11')
  const t = initTRPC.create()
  expect(isOrpcRouter(t.router({}))).toBe(false)
  expect(isOrpcRouter(t.router({hello: t.procedure.query(() => 'ok')}))).toBe(false)
})
