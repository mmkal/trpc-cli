import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {createCli, type TrpcCliMeta} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()
const t = trpc

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
    // Higher-level test command that doesn't require env variables
    if (process.argv.includes('--testComplete')) {
      const fragment = process.argv[process.argv.indexOf('--testComplete') + 1] || ''
      const parts = fragment.split(' ')

      // Generate completions for the given fragment
      const results: string[] = []
      completion.on('complete', (fragment, callback) => {
        // Simulate omelette's internal fragment handling
        switch (parts.length) {
          case 1: {
            // First-level commands
            callback(Object.keys(router))

            break
          }
          case 2: {
            // Second-level commands
            const firstLevel = router[parts[0]] as any
            if (firstLevel) {
              callback(Object.keys(firstLevel))
            }

            break
          }
          case 3: {
            // Third-level commands
            const firstLevel = router[parts[0]] as any
            if (firstLevel && firstLevel[parts[1]]) {
              callback(Object.keys(firstLevel[parts[1]]))
            }

            break
          }
          // No default
        }
      })

      // Get and output the completions
      completion.next(() => {
        console.log(results.join('\n'))
        process.exit(0)
      })

      return completion
    }
    return completion
  },
})
