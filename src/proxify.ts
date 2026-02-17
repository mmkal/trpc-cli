/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {initTRPC} from '@trpc/server'
import {StandardSchemaV1} from './standard-schema/contract.js'
import {
  AnyProcedure,
  AnyRouter,
  CLIProcedureLike,
  CLIRouterLike,
  isCliProcedure,
  isCliRouter,
  isOrpcProcedure,
  isOrpcRouter,
  OrpcRouterLike,
} from './trpc-compat.js'

const orpcServerOrError = await import('@orpc/server').catch(String)
const getOrpcServerModule = () => {
  if (typeof orpcServerOrError === 'string') {
    throw new Error(`@orpc/server must be installed to proxify oRPC routers. Error loading: ${orpcServerOrError}`)
  }
  return orpcServerOrError
}

/**
 * EXPERIMENTAL: Don't use unless you're willing to help figure out the API, and whether it should even exist.
 * See description in https://github.com/mmkal/trpc-cli/pull/153
 */
export const proxify = <R extends AnyRouter>(router: R, getClient: (procedurePath: string) => unknown) => {
  if (isCliRouter(router)) return proxifyCliRouter(router, getClient) as unknown as R
  if (isOrpcRouter(router)) return proxifyOrpcRouter(router, getClient) as unknown as R
  return proxifyTrpcRouter(router, getClient) as unknown as R
}

const proxifyTrpcRouter = (router: AnyRouter, getClient: (procedurePath: string) => unknown) => {
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

    if (isCliProcedure(oldProc)) throw new Error('Cannot proxy CLI procedures via tRPC proxifier')
    if (isOrpcProcedure(oldProc)) throw new Error('Cannot proxy ORPC procedures via tRPC proxifier')

    const inputs = oldProc._def.inputs as StandardSchemaV1[]

    inputs?.forEach(input => {
      newProc = newProc.input(input)
    })
    if (oldProc._def.type === 'query') {
      newProc = newProc.query(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return client[procedurePath].query(input)
      })
    } else if (oldProc._def.type === 'mutation') {
      newProc = newProc.mutation(async ({input}: any) => {
        const client: any = await getClient(procedurePath)
        return client[procedurePath].mutate(input)
      })
    }

    currentRouter[parts[parts.length - 1]] = newProc
  }

  return trpc.router(outputRouterRecord)
}

const proxifyOrpcRouter = (router: OrpcRouterLike<any>, getClient: (procedurePath: string) => unknown) => {
  const {traverseContractProcedures, isProcedure, os} = getOrpcServerModule()
  const outputRouterRecord: any = {}

  traverseContractProcedures({path: [], router: router as any}, ({contract, path}) => {
    let procedure: Record<string, unknown> = router
    for (const p of path) procedure = procedure[p] as Record<string, unknown>
    if (!isProcedure(procedure)) return

    const procedurePath = path.join('.')
    const inputSchema = contract['~orpc'].inputSchema

    let newProc: any = os
    if (inputSchema) {
      newProc = newProc.input(inputSchema)
    }
    newProc = newProc.handler(async ({input}: any) => {
      const client: any = await getClient(procedurePath)
      // oRPC client navigates the path hierarchy: client.deeply.nested.greeting(input)
      let target = client
      for (const p of path) target = target[p]
      return target(input)
    })

    // Place in nested structure
    const parts = procedurePath.split('.')
    let current: any = outputRouterRecord
    for (const part of parts.slice(0, -1)) {
      current = current[part] ||= {}
    }
    current[parts[parts.length - 1]] = newProc
  })

  return outputRouterRecord as OrpcRouterLike<any>
}

const proxifyCliRouter = (router: CLIRouterLike, getClient: (procedurePath: string) => unknown) => {
  const outputRouterRecord: CLIRouterLike = {}

  const walk = (r: CLIRouterLike, parentPath: string) => {
    for (const [key, value] of Object.entries(r)) {
      const childPath = parentPath ? `${parentPath}.${key}` : key
      if (isCliProcedure(value as CLIProcedureLike)) {
        const oldProc = value as CLIProcedureLike
        const newProc: CLIProcedureLike = {
          type: 'trpc-cli-command',
          input: oldProc.input,
          meta: oldProc.meta,
          fn: async ({input}) => {
            const client: any = await getClient(childPath)
            return client(childPath, input)
          },
          call: async (input: unknown) => {
            const client: any = await getClient(childPath)
            return client(childPath, input)
          },
        }

        // Place in nested structure
        const parts = childPath.split('.')
        let current: any = outputRouterRecord
        for (const part of parts.slice(0, -1)) {
          current = current[part] ||= {}
        }
        current[parts[parts.length - 1]] = newProc
      } else if (isCliRouter(value as CLIRouterLike)) {
        walk(value as CLIRouterLike, childPath)
      }
    }
  }

  walk(router, '')
  return outputRouterRecord
}
