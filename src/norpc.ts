import {StandardSchemaV1} from './standard-schema/contract.js'
import {prettifyStandardSchemaError} from './standard-schema/errors.js'
import {CLIProcedureLike, CLIRouterLike} from './trpc-compat.js'
import {TrpcCliMeta} from './types.js'

const createProcedure = <Input>(params: {
  input: StandardSchemaV1<Input>
  fn: (params: {input: Input}) => unknown
  meta?: TrpcCliMeta
}): CLIProcedureLike => {
  return {
    type: 'trpc-cli-command',
    input: params.input,
    meta: params.meta || {},
    fn: params.fn,
    call: async unvalidated => {
      const parsed = await params.input['~standard'].validate(unvalidated)
      if ('issues' in parsed) {
        throw new Error(`Invalid input: ${prettifyStandardSchemaError(parsed)}`)
      }
      return params.fn({input: parsed.value})
    },
  }
}

const handlers = <Input>(meta: TrpcCliMeta, schema: StandardSchemaV1<Input>) => {
  const define = (fn: (params: {input: Input}) => unknown) => createProcedure({input: schema, fn, meta})
  return {handler: define, query: define, mutation: define}
}

const StandardSchemaVoid: StandardSchemaV1<void> = {
  '~standard': {version: 1, vendor: 'trpc-cli', validate: async () => ({value: void 0})},
}

const router = <Procedures extends Record<string, CLIProcedureLike | CLIRouterLike>>(procedures: Procedures) =>
  procedures

const procedure = Object.assign(createProcedure, {
  input: <Input>(schema: StandardSchemaV1<Input>) => ({
    meta: (meta: TrpcCliMeta) => handlers(meta, schema),
    ...handlers({}, schema),
  }),
  meta: (meta: TrpcCliMeta) => ({
    input: <Input>(schema: StandardSchemaV1<Input>) => handlers(meta, schema),
    ...handlers(meta, StandardSchemaVoid),
  }),
  ...handlers({}, StandardSchemaVoid),
})

/** Use trpc-cli without depending on @trpc/server or @orpc/server. Use like tRPC's `t` */
export const t = {router, procedure}

/** Use trpc-cli without depending on @trpc/server or @orpc/server. Use like oRPC's `os` */
export const os = {router, ...procedure}
