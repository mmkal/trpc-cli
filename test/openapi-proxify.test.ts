import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {expect, test} from 'vitest'
import {createCli, FailedToExitError, openapiProxify, type NorpcRouterLike} from '../src/index.js'
import {petstoreOpenApi} from './fixtures/openapi.js'
import {snapshotSerializer} from './test-run.js'

expect.addSnapshotSerializer(snapshotSerializer)

test('openapiProxify exposes OpenAPI operations as a fetch-backed CLI', async () => {
  await using server = await createPetstoreServer()
  const router = openapiProxify({
    document: petstoreOpenApi,
    baseUrl: server.url,
    headers: {authorization: 'Bearer fixture-token'},
  })

  const pet = await runOpenApiCli(router, [
    'get-pet',
    '--pet-id',
    'fluffy',
    '--include',
    'toys',
    'owner',
    '--x-client-id',
    'cli-fixture',
  ])

  expect(pet).toMatchObject({
    id: 'fluffy',
    include: ['toys', 'owner'],
    authorization: 'Bearer fixture-token',
    clientId: 'cli-fixture',
  })

  const created = await runOpenApiCli(router, ['create-pet', '--body', '{"name":"Nori","age":4}'])

  expect(created).toMatchObject({
    id: 'created-pet',
    body: {name: 'Nori', age: 4},
    authorization: 'Bearer fixture-token',
    contentType: 'application/json',
  })

  expect(server.requests).toMatchObject([
    {
      method: 'GET',
      pathname: '/pets/fluffy',
      searchParams: {include: ['toys', 'owner']},
    },
    {
      method: 'POST',
      pathname: '/pets',
      body: '{"name":"Nori","age":4}',
    },
  ])
})

test('openapiProxify reports non-2xx responses with response details', async () => {
  await using server = await createPetstoreServer()
  const router = openapiProxify({
    document: petstoreOpenApi,
    baseUrl: server.url,
  })

  await expect(runOpenApiCli(router, ['get-pet', '--pet-id', 'missing'])).rejects.toThrow(
    /GET http:\/\/127\.0\.0\.1:\d+\/pets\/missing failed with 404 Not Found: {"error":"Pet not found"}/,
  )
})

type RecordedRequest = {
  method: string
  pathname: string
  searchParams: Record<string, string[]>
  body: string
}

const createPetstoreServer = async () => {
  const requests: RecordedRequest[] = []
  const server = createServer((request, response) => {
    void handlePetstoreRequest({request, response, requests}).catch(error => {
      json(response, 500, {error: error instanceof Error ? error.message : String(error)})
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

const handlePetstoreRequest = async (params: {
  request: IncomingMessage
  response: ServerResponse
  requests: RecordedRequest[]
}) => {
  const {request, response, requests} = params
  const url = new URL(request.url || '/', 'http://fixture.local')
  const body = await readBody(request)
  requests.push({
    method: request.method || 'GET',
    pathname: url.pathname,
    searchParams: {include: url.searchParams.getAll('include')},
    body,
  })

  if (request.method === 'GET' && url.pathname === '/pets/missing') {
    json(response, 404, {error: 'Pet not found'})
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/pets/')) {
    json(response, 200, {
      id: url.pathname.split('/').at(-1),
      include: url.searchParams.getAll('include'),
      authorization: request.headers.authorization,
      clientId: request.headers['x-client-id'],
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/pets') {
    json(response, 201, {
      id: 'created-pet',
      body: JSON.parse(body),
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
    })
    return
  }

  json(response, 404, {error: 'Unhandled fixture request'})
}

const runOpenApiCli = async (router: NorpcRouterLike, argv: string[]) => {
  const cli = createCli({router})
  const logs: unknown[][] = []
  const addLogs = (...args: unknown[]) => logs.push(args)

  return cli
    .run({
      argv,
      logger: {info: addLogs, error: addLogs},
      process: {exit: _ => 0 as never},
    })
    .catch(error => {
      if (error instanceof FailedToExitError) {
        if (error.exitCode === 0) return error.cause
        if (error.cause instanceof Error) throw error.cause
        throw error
      }
      throw error
    })
}

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {'content-type': 'application/json'})
  response.end(JSON.stringify(body))
}
