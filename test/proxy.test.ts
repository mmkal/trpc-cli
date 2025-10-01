import {createTRPCClient, httpLink} from '@trpc/client'
import {initTRPC} from '@trpc/server'
import {createHTTPServer} from '@trpc/server/adapters/standalone'
import {afterAll, beforeAll, expect, test} from 'vitest'
import {z} from 'zod'
import {AnyProcedure, AnyRouter, parseRouter, TrpcCliMeta} from '../src'
import {proxify} from '../src/proxify'
import {StandardSchemaV1} from '../src/standard-schema/contract'
import {run, snapshotSerializer} from './test-run'

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

  return {server, client}
}

let server: Awaited<ReturnType<typeof runServer>>

beforeAll(async () => {
  server = await runServer()
})

afterAll(async () => {
  server.server.close()
})

test('proxy', async () => {
  const proxiedRouter = proxify(router, async () => server.client)
  expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
  expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Goodbye Bob"`,
  )
})
