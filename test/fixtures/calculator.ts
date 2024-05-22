import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {TrpcCliMeta, trpcCli} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()
const sumRouter = trpc.router({
  add: trpc.procedure
    .input(
      z.object({
        left: z.number(),
        right: z.number(),
      }),
    )
    .query(({input}) => input.left + input.right),
  subtract: trpc.procedure
    .meta({
      description: 'Subtract two numbers. Useful if you have a number and you want to make it smaller.',
    })
    .input(
      z.object({
        left: z.number(),
        right: z.number(),
      }),
    )
    .query(({input}) => input.left - input.right),
  multiply: trpc.procedure
    .input(
      z.object({
        left: z.number(),
        right: z.number(),
      }),
    )
    .query(({input}) => input.left * input.right),
  divide: trpc.procedure
    .meta({
      version: '1.0.0',
      description:
        "Divide two numbers. Useful if you have a number and you want to make it smaller and `subtract` isn't quite powerful enough for you.",
      examples: 'divide --left 8 --right 4',
    })
    .input(
      z.object({
        left: z.number().describe('The numerator of the division operation.'),
        right: z
          .number()
          .refine(n => n !== 0)
          .describe('The denominator of the division operation. Note: must not be zero.'),
      }),
    )
    .mutation(({input}) => input.left / input.right),
})

void trpcCli({router: sumRouter}).run()
