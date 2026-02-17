/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {initTRPC} from '@trpc/server'
import {JSONSchema7} from 'json-schema'
import {AnyRouter, parseRouter} from './parse-router.js'
import {StandardSchemaV1} from './standard-schema/contract.js'

/**
 * EXPERIMENTAL: Don't use unless you're willing to help figure out the API, and whether it should even exist.
 * See description in https://github.com/mmkal/trpc-cli/pull/153
 *
 * Note: for now, this can accept any valid router, but it will always give you back a trpc v11 router.
 */
export const proxify = <R extends AnyRouter>(router: R, getClient: (procedurePath: string) => unknown) => {
  const parsed = parseRouter({router})
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
