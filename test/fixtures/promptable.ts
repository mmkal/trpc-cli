import * as prompts from '@inquirer/prompts'
import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {createCli, type TrpcCliMeta} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  challenge: trpc.router({
    harshly: trpc.procedure
      .meta({
        description: 'Challenge the user - they will have to say whether they are sure or not',
      })
      .input(
        z.object({
          areYouSure: z.boolean().describe('Are you sure?'),
        }),
      )
      .query(({input}) => JSON.stringify(input)),
    gently: trpc.procedure
      .meta({
        description: 'Give the user a chance to be confident',
      })
      .input(
        z.object({
          areYouConfident: z.boolean().describe('Are you confident?'),
        }),
      )
      .query(({input}) => JSON.stringify(input)),
  }),
  ingratiate: trpc.router({
    modestly: trpc.procedure.query(() => 'nice to see you'),
    extravagantly: trpc.procedure.query(() => 'you are a sight for sore eyes'),
  }),
})

void createCli({router}).run({prompts})
