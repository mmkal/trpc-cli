/* eslint-disable @typescript-eslint/no-explicit-any */

import {StandardSchemaV1} from './standard-schema/contract'

/**
 * Type which looks *enough* like a trpc v11(+?) router to infer its types correctly
 * This is written from scratch to avoid any kind of dependency on @trpc/server v11+
 */
export type Trpc11RouterLike = {
  _def: {
    _config: {
      $types: {meta: any; ctx: any}
    }
    procedures: Record<string, Trpc11ProcedureLike | Trpc11ProcedureRecordLike | Record<string, Trpc11ProcedureLike>>
  }
}

/** Even though you use `t.router({})` to create a sub-router, the actual type is a record of procedures and sub-routers rather than a root-level router */
export interface Trpc11ProcedureRecordLike {
  [key: string]: Trpc11ProcedureLike | Trpc11ProcedureRecordLike
}

export type Trpc11ProcedureLike = {
  _def: {
    type: 'mutation' | 'query' | 'subscription'
    _type?: undefined
    meta?: any
    inputs?: unknown[] // this isn't actually exposed by trpc v11 (as of 11.0.0-rc.502)
    $types: {input: any; output: any}
  }
}

export type Trpc10RouterLike = {
  _def: {
    _config: {
      $types: {meta: any; ctx: any}
    }
    procedures: Record<string, Trpc10ProcedureLike | Trpc10RouterLike>
  }
}

export type Trpc10ProcedureLike = {
  _def: {
    type?: undefined
    mutation?: boolean
    query?: boolean
    subscription?: boolean
    meta?: any
    inputs: unknown[]
    _input_in: any
    _output_out: any
  }
}

export type OrpcProcedureLike<Ctx> = {
  '~orpc': {
    __initialContext?: (context: Ctx) => unknown
    inputSchema?: StandardSchemaV1
  }
}

export type OrpcRouterLike<Ctx> = {
  [key: string]: OrpcProcedureLike<Ctx> | OrpcRouterLike<Ctx>
}

export type CreateCallerFactoryLike<Procedures = Record<string, (input: unknown) => unknown>> = (
  router: any,
) => (context: any) => Procedures

export type AnyRouter = Trpc10RouterLike | Trpc11RouterLike | OrpcRouterLike<any>

export type AnyProcedure = Trpc10ProcedureLike | Trpc11ProcedureLike

export type inferRouterContext<R extends AnyRouter> = R extends Trpc10RouterLike | Trpc11RouterLike
  ? R['_def']['_config']['$types']['ctx']
  : R extends OrpcRouterLike<infer Ctx>
    ? Ctx
    : never

export const isTrpc11Procedure = (procedure: AnyProcedure): procedure is Trpc11ProcedureLike => {
  return 'type' in procedure._def && typeof procedure._def.type === 'string'
}

export const isTrpc11Router = (router: AnyRouter): router is Trpc11RouterLike => {
  if (isOrpcRouter(router)) return false
  const procedure = Object.values(router._def.procedures)[0] as AnyProcedure | undefined
  return Boolean(procedure && isTrpc11Procedure(procedure))
}

export const isOrpcRouter = (router: AnyRouter): router is OrpcRouterLike<any> => {
  const values: never[] = []
  for (const v of Object.values(router)) {
    if (typeof v === 'function') return false
    values.push(v as never)
  }
  return values.some(isOrpcProcedure) || values.some(isOrpcRouter)
  // if (values.some(isOrpcProcedure)) return true
  // if (values.some(isOrpcRouter)) return true
  // return false
}

export const isOrpcProcedure = (procedure: {}): procedure is OrpcProcedureLike<any> => {
  return typeof procedure === 'object' && '~orpc' in procedure && typeof procedure['~orpc'] === 'object'
}
