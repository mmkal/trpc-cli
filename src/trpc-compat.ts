/* eslint-disable @typescript-eslint/no-explicit-any */

import {StandardSchemaV1} from './standard-schema/contract.js'
import {TrpcCliMeta} from './types.js'

export type CLIProcedureLike = {
  type: 'trpc-cli-command'
  input: StandardSchemaV1
  meta: TrpcCliMeta
  fn: (params: {input: any; ctx?: any; context?: any}) => any
  call: (input: unknown, context?: unknown) => unknown
}

export type CLIRouterLike = {
  [key: string]: CLIProcedureLike | CLIRouterLike
}

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

export type AnyRouter = Trpc10RouterLike | Trpc11RouterLike | OrpcRouterLike<any> | CLIRouterLike

export type AnyProcedure = Trpc10ProcedureLike | Trpc11ProcedureLike | CLIProcedureLike

export type inferRouterContext<R extends AnyRouter> = R extends Trpc10RouterLike | Trpc11RouterLike
  ? R['_def']['_config']['$types']['ctx']
  : R extends OrpcRouterLike<infer Ctx>
    ? Ctx
    : never

export const isTrpc11Procedure = (procedure: AnyProcedure): procedure is Trpc11ProcedureLike => {
  return '_def' in procedure && 'type' in procedure._def && typeof procedure._def.type === 'string'
}

export const isCliRouter = (router: AnyRouter | AnyProcedure): router is CLIRouterLike => {
  if (!router || typeof router !== 'object' || Array.isArray(router)) return false
  return Object.values(router).every(v => isCliProcedure(v as AnyProcedure) || isCliRouter(v as AnyRouter))
}

export const isCliProcedure = (procedure: AnyProcedure): procedure is CLIProcedureLike => {
  return typeof procedure === 'object' && 'type' in procedure && procedure.type === 'trpc-cli-command'
}

export const isTrpc11Router = (router: AnyRouter): router is Trpc11RouterLike => {
  if (isOrpcRouter(router)) return false
  if (isCliRouter(router)) return false
  const procedure = Object.values(router._def.procedures)[0] as AnyProcedure | undefined
  return Boolean(procedure && isTrpc11Procedure(procedure))
}

// no way to actually check a router, because they are just records of procedures and sub-routers.
// so recursively check values for procedures and sub-routers
export const isOrpcRouter = (router: AnyRouter): router is OrpcRouterLike<any> => {
  const values: never[] = []
  for (const v of Object.values(router)) {
    if (typeof v === 'function') return false
    values.push(v as never)
  }
  return values.every(v => isOrpcProcedure(v) || isOrpcRouter(v))
}

export const isOrpcProcedure = (procedure: {}): procedure is OrpcProcedureLike<any> => {
  return typeof procedure === 'object' && '~orpc' in procedure && typeof procedure['~orpc'] === 'object'
}
