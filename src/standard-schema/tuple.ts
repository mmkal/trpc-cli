import {StandardSchemaV1} from './contract.js'

/**
 * Validate `value` as a tuple whose elements are validated by `schemas` in order. Missing trailing elements are
 * validated as `undefined`, so optional trailing schemas (and ones with defaults) behave as they would in a
 * function call with the argument omitted. Issue paths are prefixed with the element index. Returns synchronously
 * unless one of the schemas validates asynchronously.
 */
export const validateTuple = (
  schemas: StandardSchemaV1[],
  value: unknown,
): StandardSchemaV1.Result<unknown[]> | Promise<StandardSchemaV1.Result<unknown[]>> => {
  if (!Array.isArray(value)) return {issues: [{message: `Expected an array of ${schemas.length} arguments`}]}
  const results = schemas.map((schema, i) => schema['~standard'].validate(value[i]))
  const combine = (settled: Array<StandardSchemaV1.Result<unknown>>): StandardSchemaV1.Result<unknown[]> => {
    const issues = settled.flatMap((result, i) =>
      result.issues ? result.issues.map(issue => ({...issue, path: [i, ...(issue.path || [])]})) : [],
    )
    if (issues.length > 0) return {issues}
    return {value: settled.map(result => (result as StandardSchemaV1.SuccessResult<unknown>).value)}
  }
  return results.some(result => result instanceof Promise)
    ? Promise.all(results.map(result => Promise.resolve(result))).then(combine)
    : combine(results as Array<StandardSchemaV1.Result<unknown>>)
}
