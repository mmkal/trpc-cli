export * as trpcServer from '@trpc/server'
export {z} from 'zod/v4'
export * as zod from 'zod/v4'

declare module 'zod/v4' {
  interface Dummy {}
}
declare module '@trpc/server' {
  interface Dummy {}
}
