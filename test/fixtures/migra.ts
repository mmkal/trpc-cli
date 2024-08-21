/* eslint-disable no-console */
import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {createCli, type TrpcCliMeta} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  migra: trpc.procedure
    .meta({description: 'Diff two schemas.'})
    .input(
      z.tuple([
        z.string().describe('Base database URL'), //
        z.string().describe('Head database URL'),
        z.object({
          unsafe: z.boolean().default(false).describe('Allow destructive commands'),
        }),
      ]),
    )
    .query(async ({input: [base, head, opts]}) => {
      console.log('connecting to...', base)
      console.log('connecting to...', head)
      const statements = ['create table foo(id int)']
      if (opts.unsafe) {
        statements.push('drop table bar')
      }
      return statements.join('\n')
    }),
})

const cli = createCli({
  router,
  default: {procedure: 'migra'},
})
void cli.run()
