import {initTRPC as initTRPC_v10} from 'trpcserver10'
import {initTRPC as initTRPC_v11} from 'trpcserver11'
import {expect, expectTypeOf, test, vi} from 'vitest'
import {createCli, TrpcCliMeta, z} from '../src'
import {Trpc10RouterLike, Trpc11RouterLike} from '../src/trpc-compat'

test('can create cli from trpc v10', async () => {
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

  expectTypeOf(router).toMatchTypeOf<Trpc10RouterLike>()

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

  const cli = createCli({router})

  expect(cli).toBeDefined()

  const log = vi.fn()
  const exit = vi.fn()
  await expect(
    cli.run({argv: ['add', '1', '2'], logger: {info: log}, process: {exit: exit as never}}),
  ).rejects.toThrowError(/Program exit/)

  expect(exit).toHaveBeenCalledWith(0)
  expect(log).toHaveBeenCalledWith(3)
})

test('can create cli from trpc v11', async () => {
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
  const cli = createCli({router, createCallerFactory: initTRPC_v11.create().createCallerFactory})

  expect(cli).toBeDefined()

  const log = vi.fn()
  const exit = vi.fn()
  await expect(
    cli.run({argv: ['add', '1', '2'], logger: {info: log}, process: {exit: exit as never}}),
  ).rejects.toThrowError(/Program exit/)
  expect(exit).toHaveBeenCalledWith(0)
  expect(log).toHaveBeenCalledWith(3)
})

test('error when using trpc v11 without createCallerFactory', async () => {
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

  const runAndCaptureProcessExit = async ({argv}: {argv: string[]}) => {
    return cli
      .run({
        argv,
        logger: {error: () => void 0},
        process: {exit: () => void 0 as never},
      })
      .catch(err => {
        while (String(err).includes('An error was thrown but the process did not exit.')) {
          err = err.cause
        }
        throw err
      })
  }
  await expect(runAndCaptureProcessExit({argv: ['add', '1', '2']})).rejects.toThrowErrorMatchingInlineSnapshot(
    `[Error: createCallerFactory version mismatch - pass in createCallerFactory explicitly]`,
  )
})
