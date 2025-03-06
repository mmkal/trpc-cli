import {z} from 'zod'
import {createCli, type TrpcCliMeta, trpcServer} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  add: trpc.procedure
    .meta({
      description:
        'Add two numbers. Use this if you and your friend both have apples, and you want to know how many apples there are in total.',
    })
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] + input[1]),
  deeply: trpc.router({
    nested: trpc.router({
      command: trpc.procedure.input(z.object({foo: z.string()})).query(({input}) => 'ok:' + input.foo),
    }),
  }),
})

void createCli({router}).run()
