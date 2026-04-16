/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {initTRPC} from '@trpc/server'
import {JSONSchema7} from 'json-schema'
import {AnyRouter, parseOrpcRouter, parseRouter, ProcedureInfo} from './parse-router.js'
import {StandardSchemaV1} from './standard-schema/contract.js'

interface OrpcContractRouterLike {
  [key: string]: OrpcContractRouterLike | {'~orpc': {inputSchema?: StandardSchemaV1; meta?: Record<string, unknown>}}
}

const getNestedClientProcedure = (client: unknown, procedurePath: string) => {
  let current = client as Record<string, unknown>
  for (const part of procedurePath.split('.')) {
    current = current?.[part] as Record<string, unknown>
  }
  return current
}

const callClientProcedure = async (client: unknown, procedurePath: string, input: unknown, type: ProcedureInfo['type']) => {
  if (type === 'query') return (client as any)[procedurePath].query(input)
  if (type === 'mutation') return (client as any)[procedurePath].mutate(input)

  const procedure = getNestedClientProcedure(client, procedurePath) as
    | ((input: unknown) => unknown)
    | {query?: (input: unknown) => unknown; mutate?: (input: unknown) => unknown}
    | undefined

  if (typeof procedure === 'function') return procedure(input)
  if (procedure?.query) return procedure.query(input)
  if (procedure?.mutate) return procedure.mutate(input)
  throw new Error(`Could not find a callable client procedure for \`${procedurePath}\``)
}

/**
 * EXPERIMENTAL: Don't use unless you're willing to help figure out the API, and whether it should even exist.
 * See description in https://github.com/mmkal/trpc-cli/pull/153
 *
 * Note: for now, this can accept any valid router, but it will always give you back a trpc v11 router.
 */
export const proxify = <R extends AnyRouter>(
  router: R | OrpcContractRouterLike | ReturnType<typeof parseRouter>,
  getClient: (procedurePath: string) => unknown,
) => {
  const parsed = Array.isArray(router)
    ? router
    : (() => {
        const parsedRouter = parseRouter({router: router as AnyRouter})
        return parsedRouter.length
          ? parsedRouter
          : parseOrpcRouter({router: router as OrpcContractRouterLike, includeContractOnly: true})
      })()
  const trpc = initTRPC.create()
  const outputRouterRecord = {}
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
        return callClientProcedure(client, procedurePath, input, info.type)
      })
    } else if (info.type === 'mutation') {
      newProc = newProc.mutation(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return callClientProcedure(client, procedurePath, input, info.type)
      })
    } else {
      newProc = newProc.query(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return callClientProcedure(client, procedurePath, input, info.type)
      })
    }
    currentRouter[parts[parts.length - 1]] = newProc
  }
  return trpc.router(outputRouterRecord)
}
