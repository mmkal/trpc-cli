/**
 * `trpc-cli/typebox`: a vendored copy of [typebox](https://github.com/sinclairzx81/typebox)
 * (see ./vendor) whose builders return plain typebox JSON Schemas with a lazily-attached,
 * non-enumerable `~standard` prop (StandardSchemaV1 + Standard JSON Schema). That means the
 * schemas can be passed directly to trpc/orpc/norpc `.input(...)` - and therefore to trpc-cli -
 * with no wrapper and no peer dependencies.
 *
 * The vendored `Type.Script` is also patched so `/** ... *\/` comments preceding object
 * properties become JSON Schema `description` fields (used by trpc-cli for flag help text).
 *
 * @example
 * import Type from 'trpc-cli/typebox'
 *
 * const Input = Type.Script(`{
 *   /** a message to say hello to new users *\/
 *   greeting: string
 * }`)
 */
import {attachStandardSchema} from './standard.js'
import VendorType from './vendor/index.js'

// all of typebox's root exports, as types only. Value exports are deliberately not re-exported
// raw - the unwrapped builders wouldn't attach `~standard`, which would be a confusing trap.
export type * from './vendor/index.js'

export {attachStandardSchema} from './standard.js'
export type {StandardJsonSchemaConverter, StandardJsonSchemaOptions, TypeboxStandardProps} from './standard.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wrap = <Fn extends (...args: any[]) => any>(fn: Fn): Fn =>
  ((...args: never[]) => attachStandardSchema(fn(...args) as unknown)) as Fn

/**
 * The typebox `Type` namespace, with every builder wrapped so that returned schemas carry a
 * lazily-built, non-enumerable `~standard` prop. Types mirror the vendored `typeof Type`
 * exactly, so `Type.Script` static inference and `Static<typeof T>` keep working.
 */
const Type: typeof VendorType = Object.fromEntries(
  Object.entries(VendorType).map(([key, value]) => [key, typeof value === 'function' ? wrap(value as never) : value]),
) as never

export default Type
export {Type}

/** Parses a type from a TypeScript type expression. `/** ... *\/` comments preceding object properties become `description`s. */
export const Script = Type.Script

/** Compiles a type into a high performance Validator. Re-exported from the vendored `typebox/compile`. */
export {Compile} from './vendor/compile/index.js'

/** Value-level utilities (Check, Clean, Convert, Default, Parse, ...). Re-exported from the vendored `typebox/value`. */
export {Value} from './vendor/value/index.js'
