/**
 * `fn(...)`: a `z.function()`-shaped builder for module-mode commands whose input schemas can be *any* Standard
 * Schema (zod, valibot, arktype, ...). `.implement(callback)` returns a plain callable that validates its arguments
 * through the schemas and carries a hidden {@linkcode FnDefinition}, which module mode (see ./module-commands)
 * reads directly - no source parsing, and the callback's parameter names become the positional argument names.
 *
 * ```ts
 * export const sayHello = fn({input: [z.string(), z.object({shout: z.boolean()})]})
 *   .describe('greet someone')
 *   .implement((name, options) => (options.shout ? name.toUpperCase() : name))
 * ```
 *
 * Kept dependency-free (beyond the standard-schema contract) because command modules import it.
 */
import {StandardSchemaV1} from './standard-schema/contract.js'
import {prettifyStandardSchemaError, StandardSchemaV1Error} from './standard-schema/errors.js'
import {validateTuple} from './standard-schema/tuple.js'
import {TrpcCliMeta} from './types.js'

/** What `fn(...).implement(...)` attaches to the returned function, under {@linkcode fnDefinition}. */
export interface FnDefinition {
  /** tuple item schemas: leading scalars become positionals, a trailing object becomes flags. Empty = no arguments */
  input: StandardSchemaV1[]
  output: StandardSchemaV1 | undefined
  /** from `.describe()` / `.meta()` - becomes the command's meta */
  meta: TrpcCliMeta
  /** the user's callback, as passed to `.implement()` - its parameter names name the positional arguments */
  implementation: (...args: never[]) => unknown
}

/** Property key under which an implemented fn carries its {@linkcode FnDefinition}. `Symbol.for` so duplicate copies of trpc-cli agree. */
export const fnDefinition = Symbol.for('trpc-cli.fn')

export type FnImplemented<Args extends unknown[], R> = ((...args: Args) => R) & {[fnDefinition]: FnDefinition}

export const isFnImplemented = (value: unknown): value is FnImplemented<unknown[], unknown> =>
  typeof value === 'function' && fnDefinition in value

type InferArgs<T extends StandardSchemaV1[]> = {[K in keyof T]: StandardSchemaV1.InferOutput<T[K]>}

export interface FnBuilder<T extends StandardSchemaV1[]> {
  /** sets the command description (same as `.meta({description})`) */
  describe(description: string): FnBuilder<T>
  /** merges into the command meta: description, aliases, examples, etc. */
  meta(meta: TrpcCliMeta): FnBuilder<T>
  /**
   * Returns `implementation` wrapped so that calling it validates the arguments (and the result, when an `output`
   * schema was given) through the schemas. Validation is synchronous unless a schema validates asynchronously, in
   * which case the call returns a promise.
   */
  implement<R>(implementation: (...args: InferArgs<T>) => R): FnImplemented<InferArgs<T>, R>
}

export function fn<T extends StandardSchemaV1[] = []>(
  config: {input?: [...T]; output?: StandardSchemaV1} = {},
): FnBuilder<T> {
  return builder({input: config.input || [], output: config.output, meta: {}})
}

const builder = <T extends StandardSchemaV1[]>(definition: Omit<FnDefinition, 'implementation'>): FnBuilder<T> => ({
  describe: description => builder({...definition, meta: {...definition.meta, description}}),
  meta: meta => builder({...definition, meta: {...definition.meta, ...meta}}),
  implement: implementation => {
    const {input, output} = definition
    const finish = (validated: StandardSchemaV1.Result<unknown[]>) => {
      if (validated.issues) throw validationError(validated)
      const result = (implementation as (...args: unknown[]) => unknown)(...validated.value)
      if (!output) return result
      const checked = output['~standard'].validate(result)
      const unwrap = (r: StandardSchemaV1.Result<unknown>) => {
        if (r.issues) throw validationError(r)
        return r.value
      }
      return checked instanceof Promise ? checked.then(unwrap) : unwrap(checked)
    }
    const implemented = (...args: unknown[]) => {
      const validated = validateTuple(input, args)
      return validated instanceof Promise ? validated.then(finish) : finish(validated)
    }
    Object.defineProperty(implemented, fnDefinition, {
      enumerable: false,
      value: {...definition, implementation} satisfies FnDefinition,
    })
    return implemented as never
  },
})

const validationError = (failure: StandardSchemaV1.FailureResult) => {
  const error = new StandardSchemaV1Error(failure)
  error.message = prettifyStandardSchemaError(error) || error.message
  return error
}
