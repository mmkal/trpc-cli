/* eslint-disable @typescript-eslint/no-explicit-any */

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

export type CreateCallerFactoryLike = (router: any) => (context: any) => Record<string, (input: unknown) => unknown>

export type AnyRouter = Trpc10RouterLike | Trpc11RouterLike

export type AnyProcedure = Trpc10ProcedureLike | Trpc11ProcedureLike

export type inferRouterContext<R extends AnyRouter> = R['_def']['_config']['$types']['ctx']

export const isTrpc11Procedure = (procedure: AnyProcedure): procedure is Trpc11ProcedureLike => {
  return 'type' in procedure._def && typeof procedure._def.type === 'string'
}

export const isTrpc11Router = (router: AnyRouter): router is Trpc11RouterLike => {
  const procedure = Object.values(router._def.procedures)[0] as AnyProcedure | undefined
  return Boolean(procedure && isTrpc11Procedure(procedure))
}
