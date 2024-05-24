import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {TrpcCliMeta, trpcCli} from '../../src'

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
    .meta({
      description: 'Subtract two numbers. Useful if you have a number and you want to make it smaller.',
    })
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] - input[1]),
  multiply: trpc.procedure
    .meta({
      description:
        'Multiply two numbers together. Useful if you want to count the number of tiles on your bathroom wall and are short on time.',
    })
    .input(z.tuple([z.number(), z.number()]))
    .query(({input}) => input[0] * input[1]),
  divide: trpc.procedure
    .meta({
      version: '1.0.0',
      description:
        "Divide two numbers. Useful if you have a number and you want to make it smaller and `subtract` isn't quite powerful enough for you.",
      examples: 'divide --left 8 --right 4',
    })
    .input(
      z.tuple([
        z.number().describe('numerator'),
        z
          .number()
          .refine(n => n !== 0)
          .describe('denominator'),
      ]),
    )
    .mutation(({input}) => input[0] / input[1]),
})

void trpcCli({router}).run()
