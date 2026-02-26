import * as trpcServer from '@trpc/server'
import {z} from 'zod/v4'
import {createCli, type TrpcCliMeta} from '../../src/index.js'
import * as parseRouter from '../../src/parse-router.js'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const migrations = getMigrations()

const searchProcedure = trpc.procedure
  .meta({
    aliases: {
      options: {status: 's'},
    },
  })
  .input(
    z.object({
      status: z.enum(['executed', 'pending']).optional().describe('Filter to only show migrations with this status'),
    }),
  )
  .use(async ({next, input}) => {
    return next({
      ctx: {
        filter: (list: typeof migrations) => list.filter(m => !input.status || m.status === input.status),
      },
    })
  })

export const router = trpc.router({
  up: trpc.procedure
    .meta({description: 'Apply migrations. By default all pending migrations will be applied.'})
    .input(
      z.union([
        z.object({}).strict(), // use strict here to make sure `{step: 1}` doesn't "match" this first, just by having an ignore `step` property
        z.object({
          to: z.string().describe('Mark migrations up to this one as exectued'),
        }),
        z.object({
          step: z.number().int().positive().describe('Mark this many migrations as executed'),
        }),
      ]),
    )
    .query(async ({input}) => {
      let toBeApplied = migrations
      if ('to' in input) {
        const index = migrations.findIndex(m => m.name === input.to)
        toBeApplied = migrations.slice(0, index + 1)
      }
      if ('step' in input) {
        const start = migrations.findIndex(m => m.status === 'pending')
        toBeApplied = migrations.slice(0, start + input.step)
      }
      toBeApplied.forEach(m => (m.status = 'executed'))
      return migrations.map(m => `${m.name}: ${m.status}`)
    }),
  create: trpc.procedure
    .meta({description: 'Create a new migration'})
    .input(
      z.object({name: z.string(), content: z.string()}), //
    )
    .mutation(async ({input}) => {
      migrations.push({...input, status: 'pending'})
      return migrations
    }),
  list: searchProcedure.meta({description: 'List all migrations'}).query(({ctx}) => ctx.filter(migrations)),
  search: trpc.router({
    byName: searchProcedure
      .meta({description: 'Look for migrations by name'})
      .input(z.object({name: z.string()}))
      .query(({ctx, input}) => {
        return ctx.filter(migrations.filter(m => m.name === input.name))
      }),
    byContent: searchProcedure
      .meta({
        description: 'Look for migrations by their script content',
        aliases: {
          options: {searchTerm: 'q'},
        },
      })
      .input(
        z.object({searchTerm: z.string().describe('Only show migrations whose `content` value contains this string')}),
      )
      .query(({ctx, input}) => {
        return ctx.filter(migrations.filter(m => m.content.includes(input.searchTerm)))
      }),
  }),
}) satisfies parseRouter.Trpc11RouterLike

const cli = createCli({
  router,
  name: 'migrations',
  version: '1.0.0',
  description: 'Manage migrations',
})

void cli.run()

function getMigrations() {
  return [
    {name: 'one', content: 'create table one(id int, name text)', status: 'executed'},
    {name: 'two', content: 'create view two as select name from one', status: 'executed'},
    {name: 'three', content: 'create table three(id int, foo int)', status: 'pending'},
    {name: 'four', content: 'create view four as select foo from three', status: 'pending'},
    {name: 'five', content: 'create table five(id int)', status: 'pending'},
  ]
}
