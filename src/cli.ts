#!/usr/bin/env node
import {createCli} from '.'
import {initTRPC} from '@trpc/server'
import * as path from 'path'
import {z} from 'zod'
import {Trpc11RouterLike} from './trpc-compat'
import {TrpcCliMeta} from './types'

const t = initTRPC.meta<TrpcCliMeta>().create()

const trpcCliRouter = t.router({
  run: t.procedure
    .meta({
      description: 'Run an existing trpc router as a CLI',
      default: true,
    })
    .input(
      z.tuple([
        z.string().describe('filepath of module with trpc router'),
        z.object({
          export: z
            .string()
            .optional()
            .describe(
              'The name of the export to use from the module. If not provided, all exports will be checked for a trpc router.',
            ),
        }),
      ]),
    )
    .mutation(async ({input: [filepath, options]}) => {
      const fullpath = path.resolve(process.cwd(), filepath)
      const importedModule = (await import(fullpath)) as {}
      let router: Trpc11RouterLike
      const isTrpcRouterLike = (value: unknown): value is Trpc11RouterLike =>
        Boolean((value as Trpc11RouterLike)?._def?.procedures)
      if (options.export) {
        router = (importedModule as {[key: string]: Trpc11RouterLike})[options.export]
        if (!isTrpcRouterLike(router)) {
          throw new Error(`Expected a trpc router in ${filepath}.${options.export}, got ${typeof router}`)
        }
      } else if (isTrpcRouterLike(importedModule)) {
        router = importedModule
      } else {
        const routerExports = Object.values(importedModule).filter(isTrpcRouterLike)
        if (routerExports.length !== 1) {
          throw new Error(`Expected exactly one trpc router in ${filepath}, found ${routerExports.length}`)
        }
        router = routerExports[0]
      }

      const cli = createCli({router})
      await cli.run()
    }),
})

const trpcCli = createCli({router: trpcCliRouter})

void trpcCli.run()
