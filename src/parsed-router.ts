import {hydrateParsedProcedure} from './parse-procedure.js'
import type {
  ParsedProcedure,
  ParsedRouter,
  ProcedureInfo,
  ProcedureType,
  RawParsedProcedure,
  RawParsedRouter,
  RawProcedureInfo,
} from './types.js'

const looksLikeObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const inferProcedureType = (procedure: unknown): ProcedureType | undefined => {
  if (!looksLikeObject(procedure)) return undefined
  const def = procedure['_def']
  if (!looksLikeObject(def)) return undefined
  if (typeof def.type === 'string') return def.type
  if (def.query === true) return 'query'
  if (def.mutation === true) return 'mutation'
  if (def.subscription === true) return 'subscription'
  return undefined
}

const isHydratedParsedProcedure = (
  parsedProcedure: ParsedProcedure | RawParsedProcedure,
): parsedProcedure is ParsedProcedure => {
  return typeof (parsedProcedure as ParsedProcedure).getPojoInput === 'function'
}

export const hydrateProcedureInfo = (procedureInfo: ProcedureInfo | RawProcedureInfo): ProcedureInfo => {
  const parsedProcedure = isHydratedParsedProcedure(procedureInfo.parsedProcedure)
    ? procedureInfo.parsedProcedure
    : hydrateParsedProcedure(procedureInfo.parsedProcedure)

  const procedure = 'procedure' in procedureInfo ? procedureInfo.procedure : {}
  const procedureType = procedureInfo.procedureType || inferProcedureType(procedure)
  const invoke = 'invoke' in procedureInfo ? procedureInfo.invoke : undefined

  return {
    meta: procedureInfo.meta,
    parsedProcedure,
    incompatiblePairs: procedureInfo.incompatiblePairs,
    procedure,
    ...(procedureType ? {procedureType} : {}),
    ...(invoke ? {invoke} : {}),
  }
}

export const hydrateParsedRouter = (parsedRouter: ParsedRouter | RawParsedRouter): ParsedRouter => {
  return parsedRouter.map(([procedurePath, procedureInfo]) => [procedurePath, hydrateProcedureInfo(procedureInfo)])
}

export const dehydrateParsedProcedure = (parsedProcedure: ParsedProcedure): RawParsedProcedure => {
  const {getPojoInput: _getPojoInput, ...rest} = parsedProcedure
  return rest
}

export const dehydrateProcedureInfo = (procedureInfo: ProcedureInfo): RawProcedureInfo => {
  const procedureType = procedureInfo.procedureType || inferProcedureType(procedureInfo.procedure)
  return {
    meta: procedureInfo.meta,
    parsedProcedure: dehydrateParsedProcedure(procedureInfo.parsedProcedure),
    incompatiblePairs: procedureInfo.incompatiblePairs,
    ...(procedureType ? {procedureType} : {}),
  }
}

export const dehydrateParsedRouter = (parsedRouter: ParsedRouter): RawParsedRouter => {
  return parsedRouter.map(([procedurePath, procedureInfo]) => [procedurePath, dehydrateProcedureInfo(procedureInfo)])
}

/**
 * Runtime guard for parsed router data (hydrated or raw/serializable).
 */
export const isParsedRouter = (router: unknown): router is ParsedRouter | RawParsedRouter => {
  if (!Array.isArray(router)) return false
  return router.every(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) return false
    const procedurePath = entry[0] as unknown
    const procedureInfo = entry[1] as unknown
    if (typeof procedurePath !== 'string') return false
    if (!looksLikeObject(procedureInfo)) return false
    if (!('parsedProcedure' in procedureInfo)) return false
    return looksLikeObject(procedureInfo.parsedProcedure)
  })
}
