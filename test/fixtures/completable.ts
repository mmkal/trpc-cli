import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {createCli, type TrpcCliMeta} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  deeply: trpc.router({
    nested: trpc.router({
      one: trpc.procedure
        .meta({default: true, description: 'This is command ONE'})
        .input(z.object({foo1: z.string()}))
        .query(({input}) => 'ok:' + JSON.stringify(input)),
      two: trpc.procedure.input(z.object({foo2: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
    }),
    within: trpc.router({
      three: trpc.procedure.input(z.object({foo3: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
      four: trpc.procedure.input(z.object({foo4: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
    }),
  }),
  profoundly: trpc.router({
    recursive: trpc.router({
      moreRecursive: trpc.router({
        first: trpc.procedure
          .meta({default: true})
          .input(
            z.object({
              foo1: z.enum(['aa', 'bb', 'cc']),
              foo2: z.string(),
            }),
          )
          .query(({input}) => 'ok:' + JSON.stringify(input)),
        second: trpc.procedure.input(z.object({foo2: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
      }),
      evenMoreRecursive: trpc.router({
        third: trpc.procedure.input(z.object({foo3: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
        fourth: trpc.procedure.input(z.object({foo4: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
      }),
    }),
    matryoshka: trpc.router({
      anotherRecursive: trpc.router({
        fifth: trpc.procedure.input(z.object({foo5: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
        sixth: trpc.procedure.input(z.object({foo6: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
      }),
      wowAnotherLevel: trpc.router({
        seventh: trpc.procedure.input(z.object({foo7: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
        eighth: trpc.procedure.input(z.object({foo8: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
      }),
    }),
  }),
})

void createCli({
  router,
}).run({
  completion: async () => {
    const completion = await import('omelette').then(m => m.default('completable'))
    if (process.argv.includes('--setupCompletions')) {
      completion.setupShellInitFile(process.env.SHELL_INIT_FILE)
    }
    if (process.argv.includes('--removeCompletions')) {
      completion.cleanupShellInitFile(process.env.SHELL_INIT_FILE)
    }
    return completion
  },
})
