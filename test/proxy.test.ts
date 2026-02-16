import {createTRPCClient, httpLink} from '@trpc/client'
import {initTRPC} from '@trpc/server'
import {createHTTPServer} from '@trpc/server/adapters/standalone'
import {afterAll, beforeAll, expect, test} from 'vitest'
import {z} from 'zod'
import type {RawParsedRouter, TrpcCliMeta} from '../src/index.js'
import {parseRouter as parseRouterForCli, proxify} from '../src/proxify.js'
import {run, runWith} from './test-run.js'

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

const metadataRouter = t.router({
  myProceduresForTrpcCli: t.procedure.query(() => {
    return parseRouterForCli(router as {})
  }),
})

const createClient = () => {
  return createTRPCClient<typeof router>({
    links: [httpLink({url: 'http://localhost:7500'})],
  })
}

const createMetadataClient = () => {
  return createTRPCClient<typeof metadataRouter>({
    links: [httpLink({url: 'http://localhost:7501'})],
  })
}

const runServer = async () => {
  const server = createHTTPServer({router})
  server.listen(7500)

  const client = createClient()
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

const runMetadataServer = async () => {
  const server = createHTTPServer({router: metadataRouter})
  server.listen(7501)

  const client = createMetadataClient()
  for (let i = 0; i <= 10; i++) {
    const success = await client.myProceduresForTrpcCli.query().then(
      r => Array.isArray(r) && r.length > 0,
      () => false,
    )
    if (success) break
    if (i === 10) throw new Error('Failed to connect to metadata server')
    if (!success) continue
  }

  return server
}

let server: Awaited<ReturnType<typeof runServer>>
let metadataServer: Awaited<ReturnType<typeof runMetadataServer>>

beforeAll(async () => {
  server = await runServer()
  metadataServer = await runMetadataServer()
})

afterAll(async () => {
  server.close()
  metadataServer.close()
})

test('proxy', async () => {
  const proxiedRouter = proxify(router, async () => {
    return createClient()
  })
  expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
  expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Goodbye Bob"`,
  )
})

test('proxy from parsed router data', async () => {
  const rawParsedRouter = parseRouterForCli(router as {})
  expect(rawParsedRouter[0]?.[1]?.parsedProcedure).not.toHaveProperty('getPojoInput')

  const servedParsedRouter = structuredClone(rawParsedRouter)
  expect(await runWith({router: servedParsedRouter}, ['greeting', '--help'])).toContain('--name <string>')

  const proxiedParsedRouter = proxify(servedParsedRouter, async () => createClient())

  expect(await runWith({router: proxiedParsedRouter}, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Hello Bob"`,
  )
  expect(
    await runWith({router: proxiedParsedRouter}, ['deeply', 'nested', 'farewell', '--name', 'Bob']),
  ).toMatchInlineSnapshot(`"Goodbye Bob"`)
})

test('proxy from parsed router served by tRPC procedure', async () => {
  const metadataClient: any = createMetadataClient()
  const servedParsedRouter = (await metadataClient.myProceduresForTrpcCli.query()) as RawParsedRouter

  const proxiedParsedRouter = proxify(servedParsedRouter, async () => createClient())
  expect(await runWith({router: proxiedParsedRouter}, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(
    `"Hello Bob"`,
  )
})
