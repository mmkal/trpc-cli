/* eslint-disable @typescript-eslint/no-explicit-any */
import {type JSONSchema7} from 'json-schema'
import {getProcedureInputJsonSchemas, parseJsonSchemaInputs} from './parse-procedure.js'
import {StandardSchemaV1} from './standard-schema/contract.js'
import {type Dependencies, type ParsedProcedure, type Result, type TrpcCliMeta, type TrpcCliParams} from './types.js'

// region: router/procedure types

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

// region: router/procedure guards

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const isTrpcRouter = (router: unknown): router is Trpc10RouterLike | Trpc11RouterLike => {
  if (!isRecord(router)) return false
  if (!('_def' in router) || !isRecord(router._def)) return false
  return 'procedures' in router._def && isRecord(router._def.procedures)
}

export const isTrpc11Procedure = (procedure: unknown): procedure is Trpc11ProcedureLike => {
  if (!isRecord(procedure)) return false
  if (!('_def' in procedure) || !isRecord(procedure._def)) return false
  return 'type' in procedure._def && typeof procedure._def.type === 'string'
}

export const isTrpc11Router = (router: unknown): router is Trpc11RouterLike => {
  if (!isTrpcRouter(router)) return false
  const procedures = router._def.procedures as Record<string, unknown>
  const procedure = Object.values(procedures)[0]
  return isTrpc11Procedure(procedure)
}

export const isOrpcProcedure = (procedure: unknown): procedure is OrpcProcedureLike<any> => {
  if (!isRecord(procedure)) return false
  return '~orpc' in procedure && isRecord(procedure['~orpc'])
}

type OrpcInspection = {isRouter: boolean; hasProcedure: boolean}
const inspectOrpcNode = (value: unknown): OrpcInspection => {
  if (!isRecord(value)) return {isRouter: false, hasProcedure: false}

  const values = Object.values(value)
  if (values.some(v => typeof v === 'function')) {
    return {isRouter: false, hasProcedure: false}
  }

  let hasProcedure = false
  for (const child of values) {
    if (isOrpcProcedure(child)) {
      hasProcedure = true
      continue
    }

    const nested = inspectOrpcNode(child)
    if (!nested.isRouter) {
      return {isRouter: false, hasProcedure: false}
    }
    hasProcedure ||= nested.hasProcedure
  }

  return {isRouter: true, hasProcedure}
}

// no reliable way to detect empty ORPC routers - they can look like plain objects.
// so we require at least one procedure-shaped value somewhere in the tree.
export const isOrpcRouter = (router: unknown): router is OrpcRouterLike<any> => {
  const inspected = inspectOrpcNode(router)
  return inspected.isRouter && inspected.hasProcedure
}

// region: router parsing

const orpcServerOrError = await import('@orpc/server').catch(String)
const getOrpcServerModule = () => {
  if (typeof orpcServerOrError === 'string') {
    throw new Error(`@orpc/server must be installed. Error loading: ${orpcServerOrError}`)
  }
  return orpcServerOrError
}

export type ProcedureInfo = {
  meta: TrpcCliMeta
  inputSchemas: Result<JSONSchema7[]>
  type: 'query' | 'mutation' | null
}

/**
 * @internal takes a trpc router and returns an object that you **could** use to build a CLI, or UI, or a bunch of other things with.
 * Officially, just internal for building a CLI. GLHF.
 */
// todo: maybe refactor to remove CLI-specific concepts like "positional parameters" and "options". Libraries like trpc-ui want to do basically the same thing, but here we handle lots more validation libraries and edge cases. We could share.
export const parseRouter = <R extends AnyRouter>({router, ...dependencies}: TrpcCliParams<R>) => {
  if (isTrpcRouter(router)) {
    return parseTrpcRouter({router, ...dependencies})
  }

  return parseOrpcRouter({router: router as OrpcRouterLike<unknown>, ...dependencies})
}

const parseTrpcRouter = ({router, ...dependencies}: {router: Trpc10RouterLike | Trpc11RouterLike} & Dependencies) => {
  const defEntries = Object.entries<AnyProcedure>(router._def.procedures as {})
  return defEntries.map(([procedurePath, procedure]): [string, ProcedureInfo] => {
    const meta = getMeta(procedure)
    const inputSchemas = getProcedureInputJsonSchemas(procedure._def.inputs as unknown[], dependencies)
    return [procedurePath, {meta, inputSchemas, type: procedure._def.type as 'query' | 'mutation'}]
  })
}

const parseOrpcRouter = ({router, ...dependencies}: {router: OrpcRouterLike<any>} & Dependencies) => {
  const entries: [string, ProcedureInfo][] = []
  const {traverseContractProcedures, isProcedure} = getOrpcServerModule()
  const lazyRoutes = traverseContractProcedures(
    {path: [], router: router as import('@orpc/server').AnyRouter},
    ({contract, path}) => {
      let procedure: Record<string, unknown> = router
      for (const p of path) procedure = procedure[p] as Record<string, unknown>
      if (!isProcedure(procedure)) return // if it's contract-only, we can't run it via CLI (user may have passed an implemented contract router? should we tell them? it's undefined behaviour so kinda on them)

      const inputSchemas = getProcedureInputJsonSchemas([contract['~orpc'].inputSchema], dependencies)
      if (path.some(p => p.includes('.'))) {
        throw new Error(`ORPC procedure path segments cannot contain \`.'. Got: ${JSON.stringify(path)}`)
      }

      const procedurePath = path.join('.')
      const meta = getMeta({_def: {meta: contract['~orpc'].meta as TrpcCliMeta}})
      entries.push([procedurePath, {meta, inputSchemas, type: null}])
    },
  )
  if (lazyRoutes.length) {
    const suggestion = `Please use \`import {unlazyRouter} from '@orpc/server'\` to unlazy the router before passing it to trpc-cli`
    const routes = lazyRoutes.map(({path}) => path.join('.')).join(', ')
    throw new Error(`Lazy routers are not supported. ${suggestion}. Lazy routes detected: ${routes}`)
  }
  return entries
}

/** helper to create a "ParsedProcedure" that just accepts a JSON string - for when we failed to parse the input schema or the use set jsonInput: true */
const jsonProcedureInputs = (reason?: string): ParsedProcedure => {
  let description = `Input formatted as JSON`
  if (reason) description += ` (${reason})`
  return {
    positionalParameters: [],
    optionsJsonSchema: {
      type: 'object',
      properties: {
        input: {description}, // omit `type` - this is json input, it could be anything
      },
    },
    getPojoInput: parsedCliParams => parsedCliParams.options.input,
  }
}

export const getParsedProcedure = (procedureInfo: ProcedureInfo): ParsedProcedure => {
  if (procedureInfo.meta.jsonInput) {
    return jsonProcedureInputs()
  }

  if (!procedureInfo.inputSchemas.success) {
    return jsonProcedureInputs(
      `procedure's schema couldn't be converted to CLI arguments: ${procedureInfo.inputSchemas.error}`,
    )
  }

  const parsedInputs = parseJsonSchemaInputs(procedureInfo.inputSchemas)
  if (!parsedInputs.success) {
    return jsonProcedureInputs(`procedure's schema couldn't be converted to CLI arguments: ${parsedInputs.error}`)
  }

  return parsedInputs.value
}

function getMeta(procedure: {_def: {meta?: {}}}): Omit<TrpcCliMeta, 'cliMeta'> {
  const meta: Partial<TrpcCliMeta> | undefined = procedure._def.meta
  return meta?.cliMeta || meta || {}
}
