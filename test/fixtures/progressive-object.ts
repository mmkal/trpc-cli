import * as prompts from '@inquirer/prompts'
import * as trpcServer from '@trpc/server'
import {z} from 'zod/v4'
import {createCli, type TrpcCliMeta} from '../../src/index.js'
import {obj} from '../../src/progressive-object.js'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const router = trpc.router({
  createApp: trpc.procedure
    .input(
      obj
        .prop('framework', z.enum(['react', 'vue']))
        .prop('rpcLibrary', inputs => z.enum(['trpc', 'orpc']).default(inputs.framework === 'react' ? 'trpc' : 'orpc'))
        .prop('clientLibrary', inputs =>
          z
            .enum(['react-query', 'tanstack-query', 'react-query-v5', 'tanstack-query-v5'])
            .default(inputs.rpcLibrary === 'trpc' ? 'react-query' : 'tanstack-query'),
        )
        .prop('typescript', inputs =>
          z.boolean().default(inputs.framework === 'react' && inputs.clientLibrary !== 'react-query-v5'),
        ),
    )
    .query(({input}) => JSON.stringify(input)),
})

void createCli({router}).run({prompts})
