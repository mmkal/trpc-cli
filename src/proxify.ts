/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {parseRouter as parseCliRouter} from './index.js'
import {initTRPC} from '@trpc/server'
import {dehydrateParsedRouter, hydrateParsedRouter, isParsedRouter} from './parsed-router.js'
import {StandardSchemaV1} from './standard-schema/contract.js'
import {AnyProcedure, AnyRouter} from './trpc-compat.js'
import type {Dependencies, ParsedRouter, ProcedureInfo, ProcedureType, RawParsedRouter, TrpcCliParams} from './types.js'

const getProcedureType = (procedure: AnyProcedure): ProcedureType | undefined => {
  if ('type' in procedure._def && typeof procedure._def.type === 'string') {
    return procedure._def.type
  }
  if ('query' in procedure._def && procedure._def.query === true) return 'query'
  if ('mutation' in procedure._def && procedure._def.mutation === true) return 'mutation'
  if ('subscription' in procedure._def && procedure._def.subscription === true) return 'subscription'
  return undefined
}

const callClient = async (params: {
  client: any
  procedurePath: string
  procedureType?: ProcedureType
  input: unknown
}) => {
  const procedureType = params.procedureType || 'query'
  if (procedureType === 'query') return params.client[params.procedurePath].query(params.input)
  if (procedureType === 'mutation') return params.client[params.procedurePath].mutate(params.input)
  throw new Error(`Unsupported procedure type for proxify: ${procedureType}`)
}

/**
 * Build serializable parsed router data that can be returned from a server procedure.
 *
 * Example:
 *
 * ```ts
 * myProceduresForTrpcCli: t.procedure.query(() => parseRouter(myRouter as {}))
 * ```
 */
export const parseRouter = <R extends AnyRouter>(router: R, dependencies: Dependencies = {}): RawParsedRouter => {
  const parsed = parseCliRouter({router, ...dependencies} as TrpcCliParams<R>)
  return dehydrateParsedRouter(parsed)
}

/**
 * EXPERIMENTAL: Don't use unless you're willing to help figure out the API, and whether it should even exist.
 * See description in https://github.com/mmkal/trpc-cli/pull/153
 */
export function proxify<R extends AnyRouter>(router: R, getClient: (procedurePath: string) => unknown): R
export function proxify(
  router: ParsedRouter | RawParsedRouter,
  getClient: (procedurePath: string) => unknown,
): ParsedRouter
export function proxify(
  router: AnyRouter | ParsedRouter | RawParsedRouter,
  getClient: (procedurePath: string) => unknown,
): AnyRouter | ParsedRouter {
  if (isParsedRouter(router)) {
    return hydrateParsedRouter(router).map(([procedurePath, procedureInfo]): [string, ProcedureInfo] => {
      return [
        procedurePath,
        {
          ...procedureInfo,
          invoke: async input => {
            const client: any = await getClient(procedurePath)
            return callClient({client, procedurePath, procedureType: procedureInfo.procedureType, input})
          },
        },
      ]
    })
  }

  const trpc = initTRPC.create()
  const outputRouterRecord = {}
  const entries = Object.entries<AnyProcedure>((router as any)._def.procedures)
  for (const [procedurePath, oldProc] of entries) {
    const parts = procedurePath.split('.')
    let currentRouter: any = outputRouterRecord
    for (const part of parts.slice(0, -1)) {
      currentRouter = currentRouter[part] ||= {}
    }
    let newProc: any = trpc.procedure

    const inputs = oldProc._def.inputs as StandardSchemaV1[]

    inputs?.forEach(input => {
      newProc = newProc.input(input)
    })
    const procedureType = getProcedureType(oldProc)
    if (procedureType === 'query') {
      newProc = newProc.query(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return callClient({client, procedurePath, procedureType, input})
      })
    } else if (procedureType === 'mutation') {
      newProc = newProc.mutation(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return callClient({client, procedurePath, procedureType, input})
      })
    } else {
      throw new Error(`Unsupported procedure type for proxify: ${String(procedureType)}`)
    }

    currentRouter[parts[parts.length - 1]] = newProc
  }

  return trpc.router(outputRouterRecord) as AnyRouter
}
