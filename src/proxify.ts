/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {JSONSchema7} from 'json-schema'
import {os as norpcOs} from './norpc.js'
import {AnyRouter, parseRouter} from './parse-router.js'
import {StandardSchemaV1} from './standard-schema/contract.js'

type OrpcLikeServerModule = {os: {input: (schema: any) => {handler: (fn: any) => any}}}
type TrpcLikeServerModule = {initTRPC: {create: () => {procedure: any; router: (input: any) => any}}}
type ServerModule = TrpcLikeServerModule | OrpcLikeServerModule

type ProxifyOptions = {
  /**
   * A function that returns a client for calling remote procedures.
   *
   * For trpc: return a trpc client (e.g. `createTRPCClient(...)`) — procedures are called via `client[dotPath].query(input)`.
   * For oRPC: return a raw oRPC client (e.g. `createORPCClient(...)`) — procedures are called by walking the nested object and calling the leaf.
   * For norpc (no `server`): same as oRPC — walk the nested object and call the leaf.
   */
  client: (procedurePath: string) => unknown
  /**
   * The RPC server module to use for building the proxified router.
   *
   * - Pass `import('@trpc/server')` to get a trpc v11 router back.
   * - Pass `import('@orpc/server')` to get an oRPC router back.
   * - Omit to use the built-in norpc builder (zero external deps).
   */
  server?: ServerModule | Promise<ServerModule>
}

const makeStandardSchema = (inputSchemas: JSONSchema7[]): StandardSchemaV1 & {toJsonSchema: () => JSONSchema7} => ({
  '~standard': {vendor: 'trpc-cli', version: 1, validate: (value: unknown) => ({value})},
  toJsonSchema: () => {
    if (inputSchemas.length === 0) return {}
    if (inputSchemas.length === 1) return inputSchemas[0]
    return {allOf: inputSchemas}
  },
})

/** Walk an oRPC-style nested client by dot-separated path and call the leaf */
const callOrpcClient = async (client: any, procedurePath: string, input: unknown) => {
  const parts = procedurePath.split('.')
  let current: any = client
  for (const part of parts) current = current[part]
  return current(input)
}

const buildWithTrpc = (
  trpcModule: TrpcLikeServerModule,
  parsed: ReturnType<typeof parseRouter>,
  getClient: (procedurePath: string) => unknown,
) => {
  const trpc = trpcModule.initTRPC.create()
  const outputRouterRecord: Record<string, any> = {}
  for (const [procedurePath, info] of parsed) {
    const parts = procedurePath.split('.')
    let currentRouter: any = outputRouterRecord
    for (const part of parts.slice(0, -1)) {
      currentRouter = currentRouter[part] ||= {}
    }
    let newProc: any = trpc.procedure
    for (const inputSchema of info.inputSchemas.success ? info.inputSchemas.value : []) {
      const standardSchema: StandardSchemaV1 & {toJsonSchema: () => JSONSchema7} = {
        '~standard': {vendor: 'trpc-cli', version: 1, validate: (value: unknown) => ({value})},
        toJsonSchema: () => inputSchema,
      }
      newProc = newProc.input(standardSchema)
    }
    if (info.type === 'query') {
      newProc = newProc.query(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return client[procedurePath].query(input)
      })
    } else if (info.type === 'mutation') {
      newProc = newProc.mutation(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return client[procedurePath].mutate(input)
      })
    } else {
      continue
    }
    currentRouter[parts[parts.length - 1]] = newProc
  }
  return trpc.router(outputRouterRecord)
}

const buildWithOs = (
  os: {input: (schema: any) => {handler: (fn: any) => any}},
  parsed: ReturnType<typeof parseRouter>,
  getClient: (procedurePath: string) => unknown,
) => {
  const outputRouterRecord: Record<string, any> = {}
  for (const [procedurePath, info] of parsed) {
    const parts = procedurePath.split('.')
    let currentRouter: any = outputRouterRecord
    for (const part of parts.slice(0, -1)) {
      currentRouter = currentRouter[part] ||= {}
    }
    const schemas = info.inputSchemas.success ? info.inputSchemas.value : []
    const standardSchema = makeStandardSchema(schemas)
    currentRouter[parts[parts.length - 1]] = os.input(standardSchema).handler(async ({input}: any) => {
      const client: any = await getClient(procedurePath)
      return callOrpcClient(client, procedurePath, input)
    })
  }
  return outputRouterRecord
}

/**
 * EXPERIMENTAL: Don't use unless you're willing to help figure out the API, and whether it should even exist.
 * See description in https://github.com/mmkal/trpc-cli/pull/153
 *
 * Creates a proxified router that delegates procedure calls to a remote client.
 *
 * @example
 * // With trpc — returns a trpc v11 router
 * const proxied = await proxify(router, {
 *   client: () => createTRPCClient({links: [httpLink({url: '...'})]}),
 *   server: import('@trpc/server'),
 * })
 *
 * @example
 * // With oRPC — returns an oRPC router
 * const proxied = await proxify(router, {
 *   client: () => createORPCClient(new RPCLink({url: '...'})),
 *   server: import('@orpc/server'),
 * })
 *
 * @example
 * // With norpc (default, zero deps) — returns a norpc router
 * const proxied = await proxify(router, {
 *   client: () => myClient,
 * })
 */
export const proxify = async <R extends AnyRouter>(
  router: R | ReturnType<typeof parseRouter>,
  options: ProxifyOptions,
) => {
  const parsed = Array.isArray(router) ? router : parseRouter({router})
  const serverModule = await options.server

  if (serverModule && 'initTRPC' in serverModule) {
    return buildWithTrpc(serverModule, parsed, options.client)
  }

  if (serverModule && 'os' in serverModule) {
    return buildWithOs(serverModule.os, parsed, options.client)
  }

  // Default: use built-in norpc builder (zero external dependencies)
  return buildWithOs(norpcOs, parsed, options.client)
}
