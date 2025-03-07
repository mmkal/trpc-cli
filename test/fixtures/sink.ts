import * as trpcServer from 'trpcserver11'
import {z} from 'zod'
import {createCli, type TrpcCliMeta} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  add: trpc.procedure
    .meta({
      description:
        'Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.',
    })
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] + input[1]),
  subtract: trpc.procedure
    .input(z.object({left: z.number(), right: z.number()}))
    .query(({input}) => input.left - input.right),
  deeply: trpc.router({
    nested1: trpc.router({
      command1: trpc.procedure
        .meta({default: true, description: 'This is command ONE'})
        .input(z.object({foo1: z.string()}))
        .query(({input}) => 'ok:' + JSON.stringify(input)),
      command2: trpc.procedure.input(z.object({foo2: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
    }),
    nested2: trpc.router({
      command3: trpc.procedure.input(z.object({foo3: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
      command4: trpc.procedure.input(z.object({foo4: z.string()})).query(({input}) => 'ok:' + JSON.stringify(input)),
    }),
  }),
})

void createCli({router}).run()
