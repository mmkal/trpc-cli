/* eslint-disable @typescript-eslint/no-misused-promises */
import {createORPCClient} from '@orpc/client'
import {RPCLink} from '@orpc/client/fetch'
import {os as orpcOs} from '@orpc/server'
import {RPCHandler} from '@orpc/server/node'
import {createTRPCClient, httpLink} from '@trpc/client'
import {initTRPC} from '@trpc/server'
import {createHTTPServer} from '@trpc/server/adapters/standalone'
import {createServer} from 'node:http'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'
import {z} from 'zod'
import {TrpcCliMeta, t as norpcT} from '../src/index.js'
import {proxify} from '../src/proxify.js'
import {run} from './test-run.js'

describe('trpc', () => {
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

  test('proxy', async () => {
    const proxiedRouter = proxify(router, async () => {
      return createTRPCClient<typeof router>({
        links: [httpLink({url: 'http://localhost:7500'})],
      })
    })
    expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
    expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
      `"Goodbye Bob"`,
    )
  })
})

describe('orpc', () => {
  const o = orpcOs.$context<{}>()

  const router = o.router({
    greeting: o
      .input(
        z.object({
          name: z.string(),
        }),
      )
      .handler(({input}) => `Hello ${input.name}`),
    deeply: {
      nested: {
        farewell: o
          .input(
            z.object({
              name: z.string(),
            }),
          )
          .handler(({input}) => `Goodbye ${input.name}`),
      },
    },
  })

  const runServer = async () => {
    const handler = new RPCHandler(router)
    const server = createServer(async (req, res) => {
      const {matched} = await handler.handle(req, res, {
        prefix: '/rpc',
        context: {},
      })
      if (!matched) {
        res.statusCode = 404
        res.end('Not found')
      }
    })
    server.listen(7501)

    // Wait for server to be ready
    const link = new RPCLink({url: 'http://localhost:7501/rpc'})
    const client: import('@orpc/server').RouterClient<typeof router> = createORPCClient(link)
    for (let i = 0; i <= 10; i++) {
      const success = await client.greeting({name: 'Bob'}).then(
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

  test('proxy', async () => {
    const proxiedRouter = proxify(router, async () => {
      const link = new RPCLink({url: 'http://localhost:7501/rpc'})
      return createORPCClient(link)
    })
    expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
    expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
      `"Goodbye Bob"`,
    )
  })
})

describe('norpc', () => {
  const router = norpcT.router({
    greeting: norpcT.procedure
      .input(
        z.object({
          name: z.string(),
        }),
      )
      .query(({input}) => `Hello ${input.name}`),
    deeply: {
      nested: {
        farewell: norpcT.procedure
          .input(
            z.object({
              name: z.string(),
            }),
          )
          .query(({input}) => `Goodbye ${input.name}`),
      },
    },
  })

  // Simple JSON-RPC-style HTTP server for norpc router
  const runServer = async () => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:7502`)
      const procedurePath = url.pathname.slice(1) // strip leading /

      let body = ''
      for await (const chunk of req) body += chunk
      const input = body ? JSON.parse(body) : undefined

      // Walk the router to find the procedure
      const parts = procedurePath.split('.')
      let current: any = router
      for (const part of parts) current = current[part]

      if (!current || current.type !== 'trpc-cli-command') {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      try {
        const result = await current.call(input)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({result}))
      } catch (err: any) {
        res.statusCode = 500
        res.end(JSON.stringify({error: err.message}))
      }
    })
    server.listen(7502)

    // Wait for server to be ready
    for (let i = 0; i <= 10; i++) {
      const success = await fetch('http://localhost:7502/greeting', {
        method: 'POST',
        body: JSON.stringify({name: 'Bob'}),
      }).then(
        r => r.ok,
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

  test('proxy', async () => {
    const proxiedRouter = proxify(router, () => {
      // Return a function that calls the remote server
      return async (procedurePath: string, input: unknown) => {
        const res = await fetch(`http://localhost:7502/${procedurePath}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(input),
        })
        const data = await res.json()
        return (data as any).result
      }
    })
    expect(await run(proxiedRouter, ['greeting', '--name', 'Bob'])).toMatchInlineSnapshot(`"Hello Bob"`)
    expect(await run(proxiedRouter, ['deeply', 'nested', 'farewell', '--name', 'Bob'])).toMatchInlineSnapshot(
      `"Goodbye Bob"`,
    )
  })
})
