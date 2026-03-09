/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {JSONSchema7} from 'json-schema'
import {os as norpcOs} from './norpc.js'
import {AnyRouter, ProcedureInfo, parseRouter} from './parse-router.js'
import {StandardSchemaV1} from './standard-schema/contract.js'

type ProxifyCallParams = {
  path: string
  info: ProcedureInfo
  input: unknown
}

type ProxifyOptions = {
  /**
   * Called to execute a procedure. You are responsible for routing to the right client method.
   *
   * @example
   * // trpc client
   * const client = createTRPCClient(...)
   * call: ({path, info, input}) => client[path][info.type!](input)
   *
   * @example
   * // oRPC client
   * const client = createORPCClient(...)
   * call: ({path, input}) => path.split('.').reduce((c, k) => c[k], client)(input)
   */
  call: (params: ProxifyCallParams) => unknown
  /**
   * The RPC server module to use for building the proxified router.
   *
   * - Pass `import('@trpc/server')` to get a trpc v11 router back.
   * - Pass `import('@orpc/server')` to get an oRPC router back.
   * - Omit to use the built-in norpc builder (zero external deps).
   */
  server?: ServerModule | Promise<ServerModule>
}

type OrpcLikeServerModule = {os: {input: (schema: any) => {handler: (fn: any) => any}}}
type TrpcLikeServerModule = {initTRPC: {create: () => {procedure: any; router: (input: any) => any}}}
type ServerModule = TrpcLikeServerModule | OrpcLikeServerModule

const makeStandardSchema = (inputSchemas: JSONSchema7[]): StandardSchemaV1 & {toJsonSchema: () => JSONSchema7} => ({
  '~standard': {vendor: 'trpc-cli', version: 1, validate: (value: unknown) => ({value})},
  toJsonSchema: () => {
    if (inputSchemas.length === 0) return {}
    if (inputSchemas.length === 1) return inputSchemas[0]
    return {allOf: inputSchemas}
  },
})

const buildWithTrpc = (
  trpcModule: TrpcLikeServerModule,
  parsed: ReturnType<typeof parseRouter>,
  call: ProxifyOptions['call'],
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
    const handler = async ({input}: any) => call({path: procedurePath, info, input})
    if (info.type === 'query') {
      newProc = newProc.query(handler)
    } else if (info.type === 'mutation') {
      newProc = newProc.mutation(handler)
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
  call: ProxifyOptions['call'],
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
      return call({path: procedurePath, info, input})
    })
  }
  return outputRouterRecord
}

/**
 * EXPERIMENTAL: Don't use unless you're willing to help figure out the API, and whether it should even exist.
 * See description in https://github.com/mmkal/trpc-cli/pull/153
 *
 * Creates a proxified router that delegates procedure calls via a user-supplied `call` function.
 *
 * @example
 * // With trpc
 * const client = createTRPCClient({links: [httpLink({url: '...'})]})
 * const proxied = await proxify(router, {
 *   call: ({path, info, input}) => client[path][info.type!](input),
 *   server: import('@trpc/server'),
 * })
 *
 * @example
 * // With oRPC
 * const client = createORPCClient(new RPCLink({url: '...'}))
 * const proxied = await proxify(router, {
 *   call: ({path, input}) => path.split('.').reduce((c, k) => c[k], client)(input),
 *   server: import('@orpc/server'),
 * })
 *
 * @example
 * // With norpc (default, zero deps)
 * const proxied = await proxify(router, {
 *   call: ({path, input}) => myClient.call(path, input),
 * })
 */
export const proxify = async <R extends AnyRouter>(
  router: R | ReturnType<typeof parseRouter>,
  options: ProxifyOptions,
) => {
  const parsed = Array.isArray(router) ? router : parseRouter({router})
  const serverModule = await options.server

  if (serverModule && 'initTRPC' in serverModule) {
    return buildWithTrpc(serverModule, parsed, options.call)
  }

  if (serverModule && 'os' in serverModule) {
    return buildWithOs(serverModule.os, parsed, options.call)
  }

  // Default: use built-in norpc builder (zero external dependencies)
  return buildWithOs(norpcOs, parsed, options.call)
}
