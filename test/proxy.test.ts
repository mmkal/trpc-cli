import {createTRPCClient, httpLink} from '@trpc/client'
import {initTRPC} from '@trpc/server'
import {createHTTPServer} from '@trpc/server/adapters/standalone'
import {afterAll, beforeAll, expect, test} from 'vitest'
import {z} from 'zod'
import {TrpcCliMeta} from '../src/index.js'
import {parseRouter} from '../src/parse-router.js'
import {proxify} from '../src/proxify.js'
import {run} from './test-run.js'

const t = initTRPC.meta<TrpcCliMeta>().create()

const router = t.router({
  greeting: t.procedure
    .input(
      z.object({
        name: z.string(),
      }),
    )
    .query(({input}) => `Hello ${input.name}`),
  deeply: {
    nested: {
      farewell: t.procedure
        .input(
          z.object({
            name: z.string(),
          }),
        )
        .query(({input}) => `Goodbye ${input.name}`),
    },
  },
})

const runServer = async () => {
  const server = createHTTPServer({router})
  server.listen(7500)

  const client = createTRPCClient<typeof router>({
    links: [httpLink({url: 'http://localhost:7500'})],
  })
  for (let i = 0; i <= 10; i++) {
    const success = await client.greeting.query({name: 'Bob'}).then(
      r => !!r,
      () => false,
    )
    if (success) break
    if (i === 10) throw new Error('Failed to connect to server')
    if (!success) continue
  }

  return server
}

let server: Awaited<ReturnType<typeof runServer>>

beforeAll(async () => {
  server = await runServer()
})

afterAll(async () => {
  server.close()
})

test('proxy with trpc server module', async () => {
  const client = createTRPCClient<typeof router>({
    links: [httpLink({url: 'http://localhost:7500'})],
  })
  const proxiedRouter = await proxify(router, {
    call: ({path, info, input}) => (client as any)[path][info.type!](input),
    server: import('@trpc/server'),
  })
  expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
  expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Goodbye Bob"`,
  )
})

test('proxy with pre-parsed router and trpc server', async () => {
  const client = createTRPCClient<typeof router>({
    links: [httpLink({url: 'http://localhost:7500'})],
  })
  const parsed = parseRouter({router})
  const proxiedRouter = await proxify(parsed, {
    call: ({path, info, input}) => (client as any)[path][info.type!](input),
    server: import('@trpc/server'),
  })
  expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
  expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Goodbye Bob"`,
  )
})

test('proxy with orpc server module', async () => {
  const trpcClient = createTRPCClient<typeof router>({
    links: [httpLink({url: 'http://localhost:7500'})],
  })
  // simulate an oRPC-style client: nested object where the leaf is a callable function
  const orpcClient = {
    greeting: (input: {name: string}) => trpcClient.greeting.query(input),
    deeply: {nested: {farewell: (input: {name: string}) => trpcClient.deeply.nested.farewell.query(input)}},
  }
  const proxiedRouter = await proxify(router, {
    call: ({path, input}) => path.split('.').reduce((c: any, k) => c[k], orpcClient)(input),
    server: import('@orpc/server'),
  })
  expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
  expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Goodbye Bob"`,
  )
})

test('proxy with norpc (default, no server module)', async () => {
  const trpcClient = createTRPCClient<typeof router>({
    links: [httpLink({url: 'http://localhost:7500'})],
  })
  const orpcClient = {
    greeting: (input: {name: string}) => trpcClient.greeting.query(input),
    deeply: {nested: {farewell: (input: {name: string}) => trpcClient.deeply.nested.farewell.query(input)}},
  }
  const proxiedRouter = await proxify(router, {
    call: ({path, input}) => path.split('.').reduce((c: any, k) => c[k], orpcClient)(input),
  })
  expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
  expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Goodbye Bob"`,
  )
})
