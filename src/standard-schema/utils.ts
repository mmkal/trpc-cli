import {StandardSchemaV1} from './contract'

export const looksLikeStandardSchemaFailure = (error: unknown): error is StandardSchemaV1.FailureResult => {
  return !!error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)
}

export const looksLikeStandardSchema = (thing: unknown): thing is StandardSchemaV1 => {
  return !!thing && typeof thing === 'object' && '~standard' in thing && typeof thing['~standard'] === 'object'
}
