import * as trpcServer from '@trpc/server'
import {z} from 'zod'
import {TrpcCliMeta, trpcCli} from '../../src'

const trpc = trpcServer.initTRPC.meta<TrpcCliMeta>().create()

const migrations = getMigrations()

const searchProcedure = trpc.procedure
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

const router = trpc.router({
  apply: trpc.procedure
    .meta({description: 'Apply migrations. By default all pending migrations will be applied.'})
    .input(
      z.union([
        z.object({
          to: z.string().optional().describe('Mark migrations up to this one as exectued'),
          step: z.never().optional(),
        }),
        z.object({
          to: z.never().optional(),
          step: z.number().int().positive().describe('Mark this many migrations as executed'),
        }),
      ]),
    )
    .query(async ({input}) => {
      let toBeApplied = migrations
      if (typeof input.to === 'string') {
        const index = migrations.findIndex(m => m.name === input.to)
        toBeApplied = migrations.slice(0, index + 1)
      }
      if (typeof input.step === 'number') {
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
      .meta({description: 'Look for migrations by their script content'})
      .input(
        z.object({searchTerm: z.string().describe('Only show migrations whose `content` value contains this string')}),
      )
      .query(({ctx, input}) => {
        return ctx.filter(migrations.filter(m => m.content.includes(input.searchTerm)))
      }),
  }),
})

const cli = trpcCli({
  router,
  alias: (fullName, {command}) => {
    if (fullName === 'status') {
      return 's'
    }
    if (fullName === 'searchTerm' && command.startsWith('search.')) {
      return 'q'
    }
    return undefined
  },
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
