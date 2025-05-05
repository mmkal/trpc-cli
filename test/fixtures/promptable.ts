import * as prompts from '@inquirer/prompts'
import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {createCli, type TrpcCliMeta} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  challenge: trpc.router({
    harshly: trpc.procedure
      .meta({
        description: 'Challenge the user',
      })
      .input(
        z.object({
          why: z.string().describe('Why are you doing this?'),
        }),
      )
      .query(({input}) => JSON.stringify(input)),
    gently: trpc.procedure
      .meta({
        description: 'Check on the user',
      })
      .input(
        z.object({
          how: z.string().describe('How are you doing?'),
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
