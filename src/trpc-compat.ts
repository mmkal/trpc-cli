import * as trpc10 from '@trpc/server'
import type * as trpc11 from 'trpcserver11' // make sure this is a type-only import, it's a devDependency

export type Trpc11Procedure = trpc11.AnyTRPCProcedure

export type AnyRouter = trpc10.AnyRouter | trpc11.AnyTRPCRouter

export type AnyProcedure = trpc10.AnyProcedure | trpc11.AnyTRPCProcedure

export type inferRouterContext<R extends AnyRouter> = R extends trpc11.AnyTRPCRouter
  ? trpc11.inferRouterContext<R>
  : R extends trpc10.AnyRouter
    ? trpc10.inferRouterContext<R>
    : never
