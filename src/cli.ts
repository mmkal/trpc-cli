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
      aliases: {
        options: {
          importFirst: 'i',
        },
      },
    })
    .input(
      z.tuple([
        z.string().describe('filepath of module with trpc router'),
        z.object({
          importFirst: z
            .string()
            .array()
            .optional()
            .describe('A module to import before the trpc router, for example `tsx/cjs`'),
        }),
      ]),
    )
    .mutation(async ({input: [filepath, options]}) => {
      for (const importFirst of options.importFirst ?? []) {
        await import(importFirst)
      }

      const fullpath = path.resolve(process.cwd(), filepath)
      const mdl = (await import(fullpath)) as {}
      let router: Trpc11RouterLike
      const isTrpcRouterLike = (value: unknown): value is Trpc11RouterLike =>
        Boolean((value as Trpc11RouterLike)?._def?.procedures)
      if (isTrpcRouterLike(mdl)) {
        router = mdl
      } else {
        const routerExports = Object.values(mdl).filter(isTrpcRouterLike)
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
