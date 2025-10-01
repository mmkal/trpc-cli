/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {initTRPC} from '@trpc/server'
import {StandardSchemaV1} from './standard-schema/contract'
import {AnyProcedure, AnyRouter} from './trpc-compat'

export const proxify = <R extends AnyRouter>(router: R, getClient: (procedurePath: string) => unknown) => {
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

  return trpc.router(outputRouterRecord) as unknown as R
}
