import {StandardSchemaV1} from './standard-schema/contract.js'
import {prettifyStandardSchemaError} from './standard-schema/errors.js'
import {CLIProcedureLike, CLIRouterLike} from './trpc-compat.js'
import {TrpcCliMeta} from './types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

// Internal type for storing middleware at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMiddlewareFn = (params: any) => Promise<unknown>

/**
 * Creates a procedure with accumulated middleware, input schema, and meta.
 */
const createProcedureInternal = <Ctx, Input>(params: {
  middlewares: AnyMiddlewareFn[]
  input: StandardSchemaV1<Input>
  fn: (params: {input: Input; ctx: Ctx; context: Ctx}) => unknown
  meta?: TrpcCliMeta
}): CLIProcedureLike => {
  return {
    type: 'trpc-cli-command',
    input: params.input,
    meta: params.meta || {},
    fn: params.fn as AnyFn,
    call: async (unvalidated, initialContext = {}) => {
      const parsed = await params.input['~standard'].validate(unvalidated)
      if ('issues' in parsed) {
        throw new Error(`Invalid input: ${prettifyStandardSchemaError(parsed)}`)
      }

      // Execute middleware chain
      let currentCtx = initialContext as Ctx

      const executeMiddlewareChain = async (index: number): Promise<unknown> => {
        if (index >= params.middlewares.length) {
          // All middleware executed, run the actual handler
          return params.fn({input: parsed.value, ctx: currentCtx, context: currentCtx})
        }

        const middleware = params.middlewares[index]
        return middleware({
          ctx: currentCtx,
          context: currentCtx,
          input: parsed.value,
          next: async (opts?: {ctx?: unknown; context?: unknown}) => {
            // Support both `ctx` and `context` for tRPC/oRPC compatibility
            const newCtx = opts?.ctx ?? opts?.context
            if (newCtx !== undefined) {
              currentCtx = {...currentCtx, ...newCtx} as Ctx
            }
            return executeMiddlewareChain(index + 1)
          },
        })
      }

      return executeMiddlewareChain(0)
    },
  }
}

const StandardSchemaVoid: StandardSchemaV1<void> = {
  '~standard': {version: 1, vendor: 'trpc-cli', validate: async () => ({value: void 0})},
}

/**
 * Middleware result type - wraps the context additions.
 * Used to help TypeScript infer context types from middleware.
 */
interface MiddlewareResult<TCtxOut> {
  ctx: TCtxOut
}

/**
 * Middleware function type.
 * Both `ctx` and `context` are supported for tRPC/oRPC compatibility.
 *
 * Note: oRPC's middleware also receives `path` and `procedure` but we don't support those yet.
 * If you need those features, use @orpc/server directly.
 */
type MiddlewareFn<TCtxIn, TCtxOut> = (params: {
  ctx: TCtxIn
  context: TCtxIn
  input: unknown
  next: <T extends object>(opts: {ctx: T} | {context: T}) => Promise<MiddlewareResult<T>>
}) => Promise<MiddlewareResult<TCtxOut>>

/**
 * Handler params passed to query/mutation/handler functions
 */
type HandlerParams<Ctx, Input> = {input: Input; ctx: Ctx; context: Ctx}

/**
 * Procedure builder interface - represents a chainable procedure definition
 */
interface ProcedureBuilder<Ctx extends object> {
  input: <Input>(schema: StandardSchemaV1<Input>) => ProcedureBuilderWithInput<Ctx, Input>
  meta: (meta: TrpcCliMeta) => ProcedureBuilder<Ctx>
  use: <TCtxOut extends object>(middlewareFn: MiddlewareFn<Ctx, TCtxOut>) => ProcedureBuilder<Ctx & TCtxOut>
  handler: (fn: (params: HandlerParams<Ctx, void>) => unknown) => CLIProcedureLike
  query: (fn: (params: HandlerParams<Ctx, void>) => unknown) => CLIProcedureLike
  mutation: (fn: (params: HandlerParams<Ctx, void>) => unknown) => CLIProcedureLike
}

/**
 * Procedure builder with input schema already defined
 */
interface ProcedureBuilderWithInput<Ctx extends object, Input> {
  meta: (meta: TrpcCliMeta) => ProcedureBuilderWithInput<Ctx, Input>
  use: <TCtxOut extends object>(
    middlewareFn: MiddlewareFn<Ctx, TCtxOut>,
  ) => ProcedureBuilderWithInput<Ctx & TCtxOut, Input>
  handler: (fn: (params: HandlerParams<Ctx, Input>) => unknown) => CLIProcedureLike
  query: (fn: (params: HandlerParams<Ctx, Input>) => unknown) => CLIProcedureLike
  mutation: (fn: (params: HandlerParams<Ctx, Input>) => unknown) => CLIProcedureLike
}

/**
 * Creates a procedure builder with the given middleware stack, meta, and optional input schema.
 */
const createProcedureBuilder = <Ctx extends object>(
  middlewares: AnyMiddlewareFn[],
  meta: TrpcCliMeta,
  inputSchema?: StandardSchemaV1,
): ProcedureBuilder<Ctx> => {
  const withInput = <Input>(schema: StandardSchemaV1<Input>): ProcedureBuilderWithInput<Ctx, Input> => {
    const handlers = {
      handler: (fn: (params: HandlerParams<Ctx, Input>) => unknown) =>
        createProcedureInternal<Ctx, Input>({middlewares, input: schema, fn, meta}),
      query: (fn: (params: HandlerParams<Ctx, Input>) => unknown) =>
        createProcedureInternal<Ctx, Input>({middlewares, input: schema, fn, meta}),
      mutation: (fn: (params: HandlerParams<Ctx, Input>) => unknown) =>
        createProcedureInternal<Ctx, Input>({middlewares, input: schema, fn, meta}),
    }
    return {
      meta: (newMeta: TrpcCliMeta) =>
        createProcedureBuilder<Ctx>(middlewares, {...meta, ...newMeta}, schema).input(schema),
      use: <TCtxOut extends object>(middlewareFn: MiddlewareFn<Ctx, TCtxOut>) =>
        createProcedureBuilder<Ctx & TCtxOut>([...middlewares, middlewareFn as AnyMiddlewareFn], meta, schema).input(
          schema,
        ),
      ...handlers,
    }
  }

  const schema = inputSchema || StandardSchemaVoid
  const handlersWithVoidInput = {
    handler: (fn: (params: HandlerParams<Ctx, void>) => unknown) =>
      createProcedureInternal<Ctx, void>({middlewares, input: schema as StandardSchemaV1<void>, fn, meta}),
    query: (fn: (params: HandlerParams<Ctx, void>) => unknown) =>
      createProcedureInternal<Ctx, void>({middlewares, input: schema as StandardSchemaV1<void>, fn, meta}),
    mutation: (fn: (params: HandlerParams<Ctx, void>) => unknown) =>
      createProcedureInternal<Ctx, void>({middlewares, input: schema as StandardSchemaV1<void>, fn, meta}),
  }

  return {
    input: withInput,
    meta: (newMeta: TrpcCliMeta) => createProcedureBuilder<Ctx>(middlewares, {...meta, ...newMeta}, inputSchema),
    use: <TCtxOut extends object>(middlewareFn: MiddlewareFn<Ctx, TCtxOut>) =>
      createProcedureBuilder<Ctx & TCtxOut>([...middlewares, middlewareFn as AnyMiddlewareFn], meta, inputSchema),
    ...handlersWithVoidInput,
  }
}

const router = <Procedures extends Record<string, CLIProcedureLike | CLIRouterLike>>(procedures: Procedures) =>
  procedures

// Base procedure builder with no middleware and empty context

const procedure: ProcedureBuilder<{}> = createProcedureBuilder<{}>([], {})

/** Use trpc-cli without depending on @trpc/server or @orpc/server. Use like tRPC's `t` */
export const t: {
  router: typeof router

  procedure: ProcedureBuilder<{}>
} = {router, procedure}

/** Use trpc-cli without depending on @trpc/server or @orpc/server. Use like oRPC's `os` */

export const os: ProcedureBuilder<{}> & {router: typeof router} = {router, ...procedure}
